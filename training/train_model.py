"""
Door2Dock -- Dock Availability Prediction Model Training

Trains two model families:
  A) FORECAST models (temporal + weather + station -- no lag)
     -> Used for planning: predicting hours/days ahead
  B) NOWCAST models  (adds current empty_docks as input)
     -> Used for "Now" page: predicting 15 min ahead with live data

For each family: Baseline, Random Forest, Gradient Boosting are compared.
Both best models are saved for deployment.

Analysis outputs:
  - TimeSeriesSplit cross-validation (3-fold expanding window)
  - SHAP feature importance (TreeExplainer for RF/GB)
  - Residual analysis: error by hour, error by station, distribution

Usage:
    python training/train_model.py
    python training/train_model.py --data path/to/merged.csv

Outputs:
    training/model_forecast.pkl           -- Best forecast model (for Plan)
    training/model_nowcast.pkl            -- Best nowcast model (for Now)
    training/model.pkl                    -- Backward-compatible copy (forecast)
    training/metrics.txt                  -- Full comparison table + CV results
    training/model_comparison.png         -- All 6 models side by side
    training/feature_importance.png       -- MDI importance (forecast)
    training/feature_importance_nowcast.png
    training/predictions.png              -- Predicted vs actual (forecast)
    training/predictions_nowcast.png
    training/shap_forecast.png            -- SHAP summary (forecast best)
    training/shap_nowcast.png             -- SHAP summary (nowcast best)
    training/residuals_forecast.png       -- Residual analysis (forecast)
    training/residuals_nowcast.png        -- Residual analysis (nowcast)
    training/cv_results.png              -- Cross-validation MAE by fold
"""

import argparse
import warnings
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.preprocessing import LabelEncoder

warnings.filterwarnings("ignore", category=FutureWarning)

OUT_DIR = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# 1. Data loading
# ---------------------------------------------------------------------------

def load_data(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, parse_dates=["timestamp"])
    print(f"Loaded {len(df):,} rows from {csv_path}")
    print(f"  Stations : {df['station_id'].nunique()}")
    print(f"  Time span: {df['timestamp'].min()} -- {df['timestamp'].max()}")
    days = (df["timestamp"].max() - df["timestamp"].min()).days
    print(f"  Duration : {days} days")
    return df


# ---------------------------------------------------------------------------
# 2. Feature engineering
# ---------------------------------------------------------------------------

WEATHER_COLS = ["temperature", "humidity", "precipitation", "wind_speed"]

FEATURES_FORECAST = [
    "hour", "hour_sin", "hour_cos", "weekday", "is_weekend",
    "temperature", "humidity", "precipitation", "wind_speed",
    "station_enc", "total_docks",
]

FEATURES_NOWCAST = FEATURES_FORECAST + ["empty_docks_lag1"]

TARGET = "target"
PREDICTION_HORIZON_MIN = 15


def engineer_features(df: pd.DataFrame):
    df = df.copy()

    # Temporal features -- fractional hours for finer-grained predictions
    dt = df["timestamp"].dt
    df["hour"] = dt.hour + dt.minute / 60
    df["weekday"] = dt.weekday          # 0=Mon .. 6=Sun
    df["is_weekend"] = (df["weekday"] >= 5).astype(int)

    # Cyclical encoding for hour (so 23->0 is close, not far apart)
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)

    # Station encoding
    le = LabelEncoder()
    df["station_enc"] = le.fit_transform(df["station_id"])

    # Target: empty_docks T+15 minutes ahead (data is minutely -> shift -15)
    df = df.sort_values(["station_id", "timestamp"])
    df["target"] = df.groupby("station_id")["empty_docks"].shift(-PREDICTION_HORIZON_MIN)

    # Lag feature: current empty_docks (used by nowcast model)
    df["empty_docks_lag1"] = df.groupby("station_id")["empty_docks"].shift(1)

    # Drop rows without weather data, lag, or target
    before = len(df)
    df = df.dropna(subset=WEATHER_COLS + ["empty_docks_lag1", "target"])
    dropped = before - len(df)
    print(f"  Dropped {dropped:,} rows with NaN (weather/lag/target) -> {len(df):,} remaining")

    # Show weather variation (important context for interpreting results)
    print("\n  Weather variation in dataset:")
    for col in WEATHER_COLS:
        lo, hi = df[col].min(), df[col].max()
        print(f"    {col:16s}  min={lo:.1f}  max={hi:.1f}  range={hi-lo:.1f}")

    return df, le


# ---------------------------------------------------------------------------
# 3. Train / test split (chronological)
# ---------------------------------------------------------------------------

def chrono_split(df: pd.DataFrame, train_frac: float = 0.8):
    df = df.sort_values("timestamp").reset_index(drop=True)
    split_idx = int(len(df) * train_frac)
    train = df.iloc[:split_idx]
    test = df.iloc[split_idx:]
    print(f"  Train: {len(train):,} rows  ({train['timestamp'].min()} -- {train['timestamp'].max()})")
    print(f"  Test : {len(test):,} rows  ({test['timestamp'].min()} -- {test['timestamp'].max()})")
    return train, test


# ---------------------------------------------------------------------------
# 4. Baseline model -- historical average per station + hour + weekday
# ---------------------------------------------------------------------------

class HistoricalAverageModel:
    """Predicts empty_docks as the mean for each (station, hour, weekday)."""

    def __init__(self):
        self.lookup = {}
        self.global_mean = 0

    def fit(self, X, y, df=None):
        """df must contain station_enc, hour, weekday, and TARGET columns."""
        if df is None:
            raise ValueError("HistoricalAverageModel.fit() needs df= parameter")
        self.global_mean = y.mean()
        # Round fractional hour to int for grouping
        tmp = df.copy()
        tmp["_hour_int"] = tmp["hour"].round().astype(int) % 24
        grouped = tmp.groupby(["station_enc", "_hour_int", "weekday"])[TARGET].mean()
        self.lookup = grouped.to_dict()
        return self

    def predict(self, X):
        preds = []
        for _, row in X.iterrows():
            key = (row["station_enc"], round(row["hour"]) % 24, row["weekday"])
            preds.append(self.lookup.get(key, self.global_mean))
        return np.array(preds)

    @property
    def feature_importances_(self):
        return None


# ---------------------------------------------------------------------------
# 5. Evaluation
# ---------------------------------------------------------------------------

def evaluate(name: str, y_true, y_pred) -> dict:
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    r2 = r2_score(y_true, y_pred)
    print(f"  {name:<35s}  MAE={mae:.2f}  RMSE={rmse:.2f}  R2={r2:.4f}")
    return {"model": name, "MAE": mae, "RMSE": rmse, "R2": r2}


# ---------------------------------------------------------------------------
# 6. Train one family of models
# ---------------------------------------------------------------------------

def train_family(name, features, train, test):
    """Train Baseline + RF + GB on given feature set. Returns results + models."""
    print(f"\n{'='*60}")
    print(f"  {name} (features: {len(features)})")
    print(f"  {features}")
    print(f"{'='*60}")

    X_train, y_train = train[features], train[TARGET]
    X_test, y_test = test[features], test[TARGET]

    results = []
    models = {}
    preds = {}

    # Baseline
    bl = HistoricalAverageModel()
    bl.fit(X_train, y_train, df=train)
    y_bl = bl.predict(X_test)
    results.append(evaluate(f"{name} / Baseline", y_test, y_bl))
    models["Baseline"] = bl
    preds["Baseline"] = y_bl

    # Random Forest
    rf = RandomForestRegressor(
        n_estimators=200, max_depth=15, min_samples_leaf=5,
        n_jobs=-1, random_state=42,
    )
    rf.fit(X_train, y_train)
    y_rf = rf.predict(X_test)
    results.append(evaluate(f"{name} / Random Forest", y_test, y_rf))
    models["Random Forest"] = rf
    preds["Random Forest"] = y_rf

    # Gradient Boosting
    gb = GradientBoostingRegressor(
        n_estimators=300, max_depth=6, learning_rate=0.1,
        min_samples_leaf=10, random_state=42,
    )
    gb.fit(X_train, y_train)
    y_gb = gb.predict(X_test)
    results.append(evaluate(f"{name} / Gradient Boosting", y_test, y_gb))
    models["Gradient Boosting"] = gb
    preds["Gradient Boosting"] = y_gb

    return results, models, preds


# ---------------------------------------------------------------------------
# 7. TimeSeriesSplit cross-validation
# ---------------------------------------------------------------------------

def run_cv(df, features, n_splits=3):
    """Expanding-window CV on the full dataset. Returns per-fold MAE for each model."""
    print(f"\n{'='*60}")
    print(f"  TimeSeriesSplit CV ({n_splits} folds, features: {len(features)})")
    print(f"{'='*60}")

    sorted_df = df.sort_values("timestamp").reset_index(drop=True)
    tscv = TimeSeriesSplit(n_splits=n_splits)

    cv_results = {"Baseline": [], "Random Forest": [], "Gradient Boosting": []}

    for fold, (train_idx, val_idx) in enumerate(tscv.split(sorted_df)):
        tr = sorted_df.iloc[train_idx]
        va = sorted_df.iloc[val_idx]
        X_tr, y_tr = tr[features], tr[TARGET]
        X_va, y_va = va[features], va[TARGET]

        print(f"\n  Fold {fold+1}: train={len(tr):,}  val={len(va):,}  "
              f"({tr['timestamp'].min().date()} to {va['timestamp'].max().date()})")

        # Baseline
        bl = HistoricalAverageModel()
        bl.fit(X_tr, y_tr, df=tr)
        mae_bl = mean_absolute_error(y_va, bl.predict(X_va))
        cv_results["Baseline"].append(mae_bl)
        print(f"    Baseline:          MAE={mae_bl:.2f}")

        # RF
        rf = RandomForestRegressor(
            n_estimators=200, max_depth=15, min_samples_leaf=5,
            n_jobs=-1, random_state=42,
        )
        rf.fit(X_tr, y_tr)
        mae_rf = mean_absolute_error(y_va, rf.predict(X_va))
        cv_results["Random Forest"].append(mae_rf)
        print(f"    Random Forest:     MAE={mae_rf:.2f}")

        # GB
        gb = GradientBoostingRegressor(
            n_estimators=300, max_depth=6, learning_rate=0.1,
            min_samples_leaf=10, random_state=42,
        )
        gb.fit(X_tr, y_tr)
        mae_gb = mean_absolute_error(y_va, gb.predict(X_va))
        cv_results["Gradient Boosting"].append(mae_gb)
        print(f"    Gradient Boosting: MAE={mae_gb:.2f}")

    # Summary
    print(f"\n  CV Summary (mean +/- std MAE):")
    for name, scores in cv_results.items():
        print(f"    {name:<22s}  {np.mean(scores):.2f} +/- {np.std(scores):.2f}")

    return cv_results


# ---------------------------------------------------------------------------
# 8. SHAP analysis
# ---------------------------------------------------------------------------

def plot_shap(model, X_test, feature_names, title, out_path):
    """SHAP summary plot using TreeExplainer (fast for RF/GB)."""
    try:
        import shap
    except ImportError:
        print(f"  SHAP not installed, skipping: {out_path}")
        print(f"  Install with: pip install shap")
        return None

    print(f"  Computing SHAP values for {title}...")

    # Subsample for speed (SHAP on full test set can be slow)
    n_sample = min(2000, len(X_test))
    X_sample = X_test.sample(n=n_sample, random_state=42)

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_sample)

    # Summary plot (beeswarm)
    fig, ax = plt.subplots(figsize=(10, 6))
    shap.summary_plot(shap_values, X_sample, feature_names=feature_names,
                      show=False, plot_size=None)
    plt.title(title, fontsize=13, pad=12)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close("all")
    print(f"  Saved: {out_path}")

    # Return mean absolute SHAP values for metrics.txt
    mean_abs_shap = np.abs(shap_values).mean(axis=0)
    shap_importance = dict(zip(feature_names, mean_abs_shap))
    return shap_importance


# ---------------------------------------------------------------------------
# 9. Residual analysis
# ---------------------------------------------------------------------------

def plot_residuals(y_true, y_pred, test_df, title, out_path):
    """4-panel residual analysis: distribution, by hour, by station, Q-Q."""
    residuals = y_true.values - y_pred

    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle(f"Residual Analysis -- {title}", fontsize=14, y=1.01)

    # Panel 1: Residual distribution
    ax = axes[0, 0]
    ax.hist(residuals, bins=80, color="#4fc3f7", edgecolor="none", alpha=0.8)
    ax.axvline(0, color="#ff7043", linestyle="--", linewidth=1.5)
    ax.set_xlabel("Residual (actual - predicted)")
    ax.set_ylabel("Count")
    ax.set_title("Residual distribution")
    median_r = np.median(residuals)
    ax.annotate(f"median={median_r:.2f}\nstd={np.std(residuals):.2f}",
                xy=(0.97, 0.95), xycoords="axes fraction", ha="right", va="top",
                fontsize=10, bbox=dict(boxstyle="round,pad=0.3", fc="white", alpha=0.8))

    # Panel 2: MAE by hour of day
    ax = axes[0, 1]
    hour_int = test_df["hour"].apply(lambda h: int(h)).values
    residual_df = pd.DataFrame({"hour": hour_int, "abs_error": np.abs(residuals)})
    hourly = residual_df.groupby("hour")["abs_error"].agg(["mean", "std"]).reset_index()
    ax.bar(hourly["hour"], hourly["mean"], color="#66bb6a", edgecolor="none", alpha=0.8)
    ax.errorbar(hourly["hour"], hourly["mean"], yerr=hourly["std"],
                fmt="none", ecolor="#333", elinewidth=0.8, capsize=2)
    ax.set_xlabel("Hour of day")
    ax.set_ylabel("MAE")
    ax.set_title("Error by hour of day")
    ax.set_xticks(range(0, 24, 3))

    # Panel 3: MAE by station (top 10 worst)
    ax = axes[1, 0]
    if "station_name" in test_df.columns:
        station_names = test_df["station_name"].apply(lambda s: s.split(",")[0]).values
    else:
        station_names = test_df["station_id"].values
    station_df = pd.DataFrame({"station": station_names, "abs_error": np.abs(residuals)})
    station_mae = station_df.groupby("station")["abs_error"].mean().sort_values(ascending=False)
    top_n = min(15, len(station_mae))
    top = station_mae.head(top_n)
    colors = ["#ef5350" if v > station_mae.mean() + station_mae.std() else "#4fc3f7" for v in top.values]
    ax.barh(range(top_n), top.values, color=colors)
    ax.set_yticks(range(top_n))
    ax.set_yticklabels(top.index, fontsize=9)
    ax.set_xlabel("MAE")
    ax.set_title(f"Error by station (top {top_n})")
    ax.invert_yaxis()
    ax.axvline(station_mae.mean(), color="#333", linestyle=":", linewidth=1, label=f"mean={station_mae.mean():.2f}")
    ax.legend(fontsize=9)

    # Panel 4: Predicted vs Actual scatter with density
    ax = axes[1, 1]
    ax.scatter(y_true, y_pred, alpha=0.08, s=6, color="#4fc3f7")
    lims = [0, max(y_true.max(), y_pred.max()) + 1]
    ax.plot(lims, lims, "--", color="#ff7043", linewidth=1.5, label="Perfect prediction")
    ax.set_xlabel("Actual empty docks")
    ax.set_ylabel("Predicted empty docks")
    ax.set_title("Predicted vs Actual")
    ax.legend(fontsize=9)
    ax.set_xlim(lims)
    ax.set_ylim(lims)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {out_path}")

    # Return summary stats for metrics.txt
    return {
        "median_residual": float(median_r),
        "std_residual": float(np.std(residuals)),
        "worst_hour": int(hourly.loc[hourly["mean"].idxmax(), "hour"]),
        "worst_hour_mae": float(hourly["mean"].max()),
        "best_hour": int(hourly.loc[hourly["mean"].idxmin(), "hour"]),
        "best_hour_mae": float(hourly["mean"].min()),
        "worst_station": station_mae.index[0],
        "worst_station_mae": float(station_mae.iloc[0]),
        "pct_within_2": float(100 * (np.abs(residuals) <= 2).mean()),
        "pct_within_5": float(100 * (np.abs(residuals) <= 5).mean()),
    }


# ---------------------------------------------------------------------------
# 10. Plotting (original + new)
# ---------------------------------------------------------------------------

def plot_feature_importance(model, feature_names, title, out_path):
    importances = model.feature_importances_
    idx = np.argsort(importances)[::-1]

    fig, ax = plt.subplots(figsize=(8, 5))
    colors = []
    for i in idx:
        fname = feature_names[i]
        if fname in WEATHER_COLS:
            colors.append("#66bb6a")   # green for weather
        elif fname in ("hour", "hour_sin", "hour_cos", "weekday", "is_weekend"):
            colors.append("#42a5f5")   # blue for temporal
        elif fname == "empty_docks_lag1":
            colors.append("#ef5350")   # red for lag
        else:
            colors.append("#ab47bc")   # purple for station

    ax.barh([feature_names[i] for i in idx], importances[idx], color=colors)
    ax.set_xlabel("Importance (MDI)")
    ax.set_title(title)
    ax.invert_yaxis()

    from matplotlib.patches import Patch
    legend_items = [
        Patch(color="#42a5f5", label="Temporal"),
        Patch(color="#66bb6a", label="Weather"),
        Patch(color="#ab47bc", label="Station"),
    ]
    if "empty_docks_lag1" in feature_names:
        legend_items.append(Patch(color="#ef5350", label="Current state"))
    ax.legend(handles=legend_items, loc="lower right", fontsize=9)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"  Saved: {out_path}")


def plot_predictions(y_true, y_pred, timestamps, title, out_path):
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    # Scatter: predicted vs actual
    ax = axes[0]
    ax.scatter(y_true, y_pred, alpha=0.15, s=8, color="#4fc3f7")
    lims = [0, max(y_true.max(), y_pred.max()) + 1]
    ax.plot(lims, lims, "--", color="#ff7043", linewidth=1.5, label="Perfect")
    ax.set_xlabel("Actual empty docks")
    ax.set_ylabel("Predicted empty docks")
    ax.set_title(f"{title} -- Predicted vs Actual")
    ax.legend()

    # Time series: first N test points
    ax = axes[1]
    n = min(200, len(y_true))
    ax.plot(timestamps[:n], y_true.values[:n], label="Actual", linewidth=1.2)
    ax.plot(timestamps[:n], y_pred[:n], label="Predicted", linewidth=1.2, alpha=0.8)
    ax.set_xlabel("Time")
    ax.set_ylabel("Empty docks")
    ax.set_title(f"{title} -- Time Series (first {n} test points)")
    ax.legend()
    ax.tick_params(axis="x", rotation=30)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"  Saved: {out_path}")


def plot_comparison(all_results, out_path):
    """Bar chart comparing MAE of all models."""
    df = pd.DataFrame(all_results)
    fig, ax = plt.subplots(figsize=(10, 5))

    colors = []
    for name in df["model"]:
        if "Forecast" in name:
            colors.append("#42a5f5")
        else:
            colors.append("#ab47bc")

    bars = ax.barh(df["model"], df["MAE"], color=colors)
    ax.set_xlabel("MAE (lower is better)")
    ax.set_title("Model Comparison -- Mean Absolute Error")
    ax.invert_yaxis()

    for bar, val in zip(bars, df["MAE"]):
        ax.text(val + 0.1, bar.get_y() + bar.get_height() / 2,
                f"{val:.2f}", va="center", fontsize=9)

    from matplotlib.patches import Patch
    ax.legend(handles=[
        Patch(color="#42a5f5", label="Forecast (no current state)"),
        Patch(color="#ab47bc", label="Nowcast (with current state)"),
    ], loc="lower right")

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"  Saved: {out_path}")


def plot_cv_results(fc_cv, nc_cv, out_path):
    """Plot CV MAE per fold for both families."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    for ax, cv_data, title in [(axes[0], fc_cv, "Forecast CV"), (axes[1], nc_cv, "Nowcast CV")]:
        n_folds = len(next(iter(cv_data.values())))
        x = np.arange(n_folds)
        width = 0.25
        colors = {"Baseline": "#9e9e9e", "Random Forest": "#42a5f5", "Gradient Boosting": "#66bb6a"}

        for i, (name, scores) in enumerate(cv_data.items()):
            bars = ax.bar(x + i * width, scores, width, label=name, color=colors.get(name, "#999"))
            for bar, val in zip(bars, scores):
                ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.05,
                        f"{val:.2f}", ha="center", va="bottom", fontsize=8)

        ax.set_xlabel("Fold")
        ax.set_ylabel("MAE")
        ax.set_title(title)
        ax.set_xticks(x + width)
        ax.set_xticklabels([f"Fold {i+1}" for i in range(n_folds)])
        ax.legend(fontsize=9)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"  Saved: {out_path}")


# ---------------------------------------------------------------------------
# 11. Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Train dock prediction model")
    parser.add_argument("--data", default="data/merged.csv", help="Path to merged CSV")
    parser.add_argument("--no-shap", action="store_true", help="Skip SHAP analysis")
    args = parser.parse_args()

    print("=" * 60)
    print("Door2Dock -- Model Training")
    print("=" * 60)

    # Load & prepare
    df = load_data(args.data)
    df, label_encoder = engineer_features(df)
    train, test = chrono_split(df)

    # ================================================================
    # A) FORECAST models (no lag -- for planning ahead)
    # ================================================================
    fc_results, fc_models, fc_preds = train_family(
        "Forecast", FEATURES_FORECAST, train, test,
    )

    # ================================================================
    # B) NOWCAST models (with current state -- for "Now" page)
    # ================================================================
    nc_results, nc_models, nc_preds = train_family(
        "Nowcast", FEATURES_NOWCAST, train, test,
    )

    # ================================================================
    # Cross-validation
    # ================================================================
    fc_cv = run_cv(df, FEATURES_FORECAST, n_splits=3)
    nc_cv = run_cv(df, FEATURES_NOWCAST, n_splits=3)

    # ================================================================
    # Pick best of each family
    # ================================================================
    all_results = fc_results + nc_results

    # Best forecast
    fc_df = pd.DataFrame(fc_results)
    fc_best_idx = fc_df["MAE"].idxmin()
    fc_best_name = fc_df.loc[fc_best_idx, "model"].replace("Forecast / ", "")
    fc_best_model = fc_models[fc_best_name]
    fc_best_preds = fc_preds[fc_best_name]

    # Best nowcast
    nc_df = pd.DataFrame(nc_results)
    nc_best_idx = nc_df["MAE"].idxmin()
    nc_best_name = nc_df.loc[nc_best_idx, "model"].replace("Nowcast / ", "")
    nc_best_model = nc_models[nc_best_name]
    nc_best_preds = nc_preds[nc_best_name]

    print(f"\n>>> Best FORECAST model: {fc_best_name}")
    print(f"    (temporal + weather + station, NO current state)")
    print(f">>> Best NOWCAST model:  {nc_best_name}")
    print(f"    (same + current empty_docks)")

    # ================================================================
    # SHAP analysis (on best sklearn models only)
    # ================================================================
    y_test = test[TARGET]
    fc_shap = None
    nc_shap = None

    if not args.no_shap:
        # Forecast SHAP -- always use a tree-based model for TreeExplainer
        fc_shap_model = fc_best_model if getattr(fc_best_model, "feature_importances_", None) is not None else fc_models["Random Forest"]
        fc_shap_label = fc_best_name if fc_shap_model is fc_best_model else "Random Forest (best was Baseline)"
        if fc_shap_model is not fc_best_model:
            print(f"  Forecast best is Baseline; running SHAP on RF for comparison")
        fc_shap = plot_shap(
            fc_shap_model, test[FEATURES_FORECAST], FEATURES_FORECAST,
            f"SHAP -- Forecast ({fc_shap_label})",
            OUT_DIR / "shap_forecast.png",
        )

        # Nowcast SHAP
        nc_shap_model = nc_best_model if getattr(nc_best_model, "feature_importances_", None) is not None else nc_models["Random Forest"]
        nc_shap_label = nc_best_name if nc_shap_model is nc_best_model else "Random Forest"
        nc_shap = plot_shap(
            nc_shap_model, test[FEATURES_NOWCAST], FEATURES_NOWCAST,
            f"SHAP -- Nowcast ({nc_shap_label})",
            OUT_DIR / "shap_nowcast.png",
        )

    # ================================================================
    # Residual analysis
    # ================================================================
    print("\n--- Residual Analysis ---")
    fc_residual_stats = plot_residuals(
        y_test.reset_index(drop=True), fc_best_preds,
        test.reset_index(drop=True),
        f"Forecast ({fc_best_name})",
        OUT_DIR / "residuals_forecast.png",
    )
    nc_residual_stats = plot_residuals(
        y_test.reset_index(drop=True), nc_best_preds,
        test.reset_index(drop=True),
        f"Nowcast ({nc_best_name})",
        OUT_DIR / "residuals_nowcast.png",
    )

    # ================================================================
    # Save models
    # ================================================================
    # ---- Save forecast model ----
    fc_path = OUT_DIR / "model_forecast.pkl"
    joblib.dump(
        {
            "model": fc_best_model,
            "features": FEATURES_FORECAST,
            "label_encoder": label_encoder,
            "model_name": fc_best_name,
            "model_type": "forecast",
            "prediction_horizon_min": PREDICTION_HORIZON_MIN,
            "metrics": fc_results,
        },
        fc_path,
    )
    print(f"  Saved forecast model -> {fc_path}")

    # ---- Save nowcast model ----
    nc_path = OUT_DIR / "model_nowcast.pkl"
    joblib.dump(
        {
            "model": nc_best_model,
            "features": FEATURES_NOWCAST,
            "label_encoder": label_encoder,
            "model_name": nc_best_name,
            "model_type": "nowcast",
            "prediction_horizon_min": PREDICTION_HORIZON_MIN,
            "metrics": nc_results,
        },
        nc_path,
    )
    print(f"  Saved nowcast model  -> {nc_path}")

    # ---- Also save as model.pkl for backward compatibility ----
    compat_path = OUT_DIR / "model.pkl"
    joblib.dump(
        {
            "model": fc_best_model,
            "features": FEATURES_FORECAST,
            "label_encoder": label_encoder,
            "model_name": fc_best_name,
            "model_type": "forecast",
            "prediction_horizon_min": PREDICTION_HORIZON_MIN,
            "metrics": all_results,
        },
        compat_path,
    )

    # ================================================================
    # Save metrics
    # ================================================================
    all_df = pd.DataFrame(all_results)
    metrics_path = OUT_DIR / "metrics.txt"
    with open(metrics_path, "w") as f:
        f.write("Door2Dock -- Model Evaluation Report\n")
        f.write("=" * 70 + "\n\n")

        # Test set results
        f.write("1. TEST SET RESULTS (80/20 chronological split)\n")
        f.write("-" * 70 + "\n\n")
        f.write("FORECAST models (temporal + weather + station, NO current state):\n")
        f.write(fc_df.to_string(index=False))
        f.write(f"\n\nBest: {fc_best_name}\n")
        f.write(f"  -> Used for: Plan page (predicting hours/days ahead)\n")
        f.write("\nNOWCAST models (same + current empty_docks):\n")
        f.write(pd.DataFrame(nc_results).to_string(index=False))
        f.write(f"\n\nBest: {nc_best_name}\n")
        f.write(f"  -> Used for: Now page (predicting 15 min ahead with live data)\n")

        # Cross-validation
        f.write(f"\n\n2. CROSS-VALIDATION (TimeSeriesSplit, 3 folds)\n")
        f.write("-" * 70 + "\n\n")
        f.write("Forecast family (MAE per fold):\n")
        for name, scores in fc_cv.items():
            f.write(f"  {name:<22s}  {' / '.join(f'{s:.2f}' for s in scores)}  "
                    f"mean={np.mean(scores):.2f} +/- {np.std(scores):.2f}\n")
        f.write("\nNowcast family (MAE per fold):\n")
        for name, scores in nc_cv.items():
            f.write(f"  {name:<22s}  {' / '.join(f'{s:.2f}' for s in scores)}  "
                    f"mean={np.mean(scores):.2f} +/- {np.std(scores):.2f}\n")

        # Residual analysis
        f.write(f"\n\n3. RESIDUAL ANALYSIS\n")
        f.write("-" * 70 + "\n")
        for label, stats in [("Forecast", fc_residual_stats), ("Nowcast", nc_residual_stats)]:
            f.write(f"\n{label}:\n")
            f.write(f"  Median residual:       {stats['median_residual']:+.2f} docks\n")
            f.write(f"  Residual std:          {stats['std_residual']:.2f} docks\n")
            f.write(f"  Worst hour:            {stats['worst_hour']:02d}:00 (MAE={stats['worst_hour_mae']:.2f})\n")
            f.write(f"  Best hour:             {stats['best_hour']:02d}:00 (MAE={stats['best_hour_mae']:.2f})\n")
            f.write(f"  Worst station:         {stats['worst_station']} (MAE={stats['worst_station_mae']:.2f})\n")
            f.write(f"  Predictions within 2:  {stats['pct_within_2']:.1f}%\n")
            f.write(f"  Predictions within 5:  {stats['pct_within_5']:.1f}%\n")

        # SHAP
        if fc_shap or nc_shap:
            f.write(f"\n\n4. SHAP FEATURE IMPORTANCE (mean |SHAP value|)\n")
            f.write("-" * 70 + "\n")
            for label, shap_imp in [("Forecast", fc_shap), ("Nowcast", nc_shap)]:
                if shap_imp:
                    f.write(f"\n{label}:\n")
                    sorted_shap = sorted(shap_imp.items(), key=lambda x: -x[1])
                    for feat, val in sorted_shap:
                        f.write(f"  {feat:<22s}  {val:.4f}\n")

        # Dataset info
        f.write(f"\n\n5. DATASET\n")
        f.write("-" * 70 + "\n")
        f.write(f"  Total rows:  {len(df):,}\n")
        f.write(f"  Train rows:  {len(train):,}\n")
        f.write(f"  Test rows:   {len(test):,}\n")
        f.write(f"  Stations:    {df['station_id'].nunique()}\n")
        f.write(f"  Time span:   {df['timestamp'].min()} -- {df['timestamp'].max()}\n")
        f.write(f"  Prediction horizon: T+{PREDICTION_HORIZON_MIN} min\n")

        # Hyperparameters
        f.write(f"\n\n6. HYPERPARAMETERS\n")
        f.write("-" * 70 + "\n")
        f.write("  Random Forest:      n_estimators=200, max_depth=15, min_samples_leaf=5\n")
        f.write("  Gradient Boosting:  n_estimators=300, max_depth=6, lr=0.1, min_samples_leaf=10\n")
        f.write("  Baseline:           mean per (station, hour_rounded, weekday) group\n")
        f.write("\n  Note: Hyperparameters were not tuned (no GridSearchCV).\n")
        f.write("  TimeSeriesSplit CV confirms stability across folds.\n")

    print(f"  Saved metrics -> {metrics_path}")

    # ================================================================
    # Plots
    # ================================================================
    # Feature importance (MDI): forecast
    if getattr(fc_best_model, "feature_importances_", None) is not None:
        plot_feature_importance(
            fc_best_model, FEATURES_FORECAST,
            f"Feature Importance (MDI) -- Forecast ({fc_best_name})",
            OUT_DIR / "feature_importance.png",
        )
    else:
        # If Baseline won, plot RF importance for reference
        print(f"  Forecast best ({fc_best_name}) has no feature_importances_; plotting RF")
        plot_feature_importance(
            fc_models["Random Forest"], FEATURES_FORECAST,
            "Feature Importance (MDI) -- Forecast (Random Forest, for reference)",
            OUT_DIR / "feature_importance.png",
        )

    # Feature importance (MDI): nowcast
    if getattr(nc_best_model, "feature_importances_", None) is not None:
        plot_feature_importance(
            nc_best_model, FEATURES_NOWCAST,
            f"Feature Importance (MDI) -- Nowcast ({nc_best_name})",
            OUT_DIR / "feature_importance_nowcast.png",
        )

    # Predictions: forecast
    plot_predictions(
        y_test.reset_index(drop=True),
        fc_best_preds,
        test["timestamp"].reset_index(drop=True),
        f"Forecast ({fc_best_name})",
        OUT_DIR / "predictions.png",
    )

    # Predictions: nowcast
    plot_predictions(
        y_test.reset_index(drop=True),
        nc_best_preds,
        test["timestamp"].reset_index(drop=True),
        f"Nowcast ({nc_best_name})",
        OUT_DIR / "predictions_nowcast.png",
    )

    # Comparison bar chart
    plot_comparison(all_results, OUT_DIR / "model_comparison.png")

    # CV results plot
    plot_cv_results(fc_cv, nc_cv, OUT_DIR / "cv_results.png")

    # ---- Summary ----
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(all_df.to_string(index=False))
    print(f"\nForecast model: {fc_best_name} (for Plan page)")
    print(f"Nowcast model:  {nc_best_name} (for Now page)")
    print(f"\nCV stability (Forecast): {' / '.join(f'{np.mean(v):.2f}+/-{np.std(v):.2f}' for v in [fc_cv['Baseline'], fc_cv['Random Forest'], fc_cv['Gradient Boosting']])}")
    print(f"CV stability (Nowcast):  {' / '.join(f'{np.mean(v):.2f}+/-{np.std(v):.2f}' for v in [nc_cv['Baseline'], nc_cv['Random Forest'], nc_cv['Gradient Boosting']])}")
    print(f"\nResiduals (Forecast): {fc_residual_stats['pct_within_2']:.0f}% within 2 docks, {fc_residual_stats['pct_within_5']:.0f}% within 5")
    print(f"Residuals (Nowcast):  {nc_residual_stats['pct_within_2']:.0f}% within 2 docks, {nc_residual_stats['pct_within_5']:.0f}% within 5")
    print("=" * 60)


if __name__ == "__main__":
    main()
