"""
Door2Dock -- Dock Availability Prediction Model Training

Trains two model families:
  A) FORECAST models (temporal + weather + station -- no lag)
     -> Useful for predicting 15-60 min ahead when current state is unknown
  B) NOWCAST models  (adds 1-min lag feature)
     -> Near-real-time correction when recent data is available

For each family: Baseline, Random Forest, Gradient Boosting are compared.
The best FORECAST model is saved as the production model.

Usage:
    python training/train_model.py
    python training/train_model.py --data path/to/merged.csv

Outputs:
    training/model.pkl                    -- Best forecast model (joblib)
    training/feature_importance.png       -- Feature importance (forecast)
    training/predictions.png              -- Predicted vs actual (forecast)
    training/model_comparison.png         -- All 6 models side by side
    training/metrics.txt                  -- Full comparison table
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

TARGET = "empty_docks"


def engineer_features(df: pd.DataFrame):
    df = df.copy()

    # Temporal features
    df["hour"] = df["timestamp"].dt.hour
    df["weekday"] = df["timestamp"].dt.weekday          # 0=Mon .. 6=Sun
    df["is_weekend"] = (df["weekday"] >= 5).astype(int)

    # Cyclical encoding for hour (so 23->0 is close, not far apart)
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)

    # Station encoding
    le = LabelEncoder()
    df["station_enc"] = le.fit_transform(df["station_id"])

    # Lag feature: previous empty_docks per station (1-minute lag)
    df = df.sort_values(["station_id", "timestamp"])
    df["empty_docks_lag1"] = df.groupby("station_id")["empty_docks"].shift(1)

    # Drop rows without weather data or lag
    before = len(df)
    df = df.dropna(subset=WEATHER_COLS + ["empty_docks_lag1"])
    dropped = before - len(df)
    print(f"  Dropped {dropped:,} rows with NaN (weather/lag) -> {len(df):,} remaining")

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
        grouped = df.groupby(["station_enc", "hour", "weekday"])[TARGET].mean()
        self.lookup = grouped.to_dict()
        return self

    def predict(self, X):
        preds = []
        for _, row in X.iterrows():
            key = (row["station_enc"], row["hour"], row["weekday"])
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
# 7. Plotting
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
    ax.set_xlabel("Importance")
    ax.set_title(title)
    ax.invert_yaxis()

    # Legend
    from matplotlib.patches import Patch
    legend_items = [
        Patch(color="#42a5f5", label="Temporal"),
        Patch(color="#66bb6a", label="Weather"),
        Patch(color="#ab47bc", label="Station"),
    ]
    if "empty_docks_lag1" in feature_names:
        legend_items.append(Patch(color="#ef5350", label="Lag"))
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

    # Time series: pick ONE station for clarity
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
        Patch(color="#42a5f5", label="Forecast (no lag)"),
        Patch(color="#ab47bc", label="Nowcast (with lag)"),
    ], loc="lower right")

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"  Saved: {out_path}")


# ---------------------------------------------------------------------------
# 8. Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Train dock prediction model")
    parser.add_argument("--data", default="data/merged.csv", help="Path to merged CSV")
    args = parser.parse_args()

    print("=" * 60)
    print("Door2Dock -- Model Training")
    print("=" * 60)

    # Load & prepare
    df = load_data(args.data)
    df, label_encoder = engineer_features(df)
    train, test = chrono_split(df)

    # ================================================================
    # A) FORECAST models (no lag -- the real prediction task)
    # ================================================================
    fc_results, fc_models, fc_preds = train_family(
        "Forecast", FEATURES_FORECAST, train, test,
    )

    # ================================================================
    # B) NOWCAST models (with lag -- near-real-time)
    # ================================================================
    nc_results, nc_models, nc_preds = train_family(
        "Nowcast", FEATURES_NOWCAST, train, test,
    )

    # ================================================================
    # Pick best FORECAST model (this is the one we deploy)
    # ================================================================
    all_results = fc_results + nc_results
    fc_df = pd.DataFrame(fc_results)
    best_idx = fc_df["MAE"].idxmin()
    best_name = fc_df.loc[best_idx, "model"].replace("Forecast / ", "")
    best_model = fc_models[best_name]
    best_preds = fc_preds[best_name]

    print(f"\n>>> Best FORECAST model: {best_name}")
    print(f"    (This model uses temporal + weather + station features, NO lag)")

    # ---- Save model ----
    model_path = OUT_DIR / "model.pkl"
    joblib.dump(
        {
            "model": best_model,
            "features": FEATURES_FORECAST,
            "label_encoder": label_encoder,
            "model_name": best_name,
            "model_type": "forecast",
            "metrics": all_results,
        },
        model_path,
    )
    print(f"  Saved model -> {model_path}")

    # ---- Save metrics ----
    all_df = pd.DataFrame(all_results)
    metrics_path = OUT_DIR / "metrics.txt"
    with open(metrics_path, "w") as f:
        f.write("Door2Dock -- Model Comparison\n")
        f.write("=" * 60 + "\n\n")
        f.write("FORECAST models (temporal + weather + station, NO lag):\n")
        f.write(fc_df.to_string(index=False))
        f.write("\n\nNOWCAST models (same + 1-min lag):\n")
        f.write(pd.DataFrame(nc_results).to_string(index=False))
        f.write(f"\n\nBest forecast model: {best_name}\n")
        f.write(f"Data rows : {len(df):,}\n")
        f.write(f"Train     : {len(train):,}\n")
        f.write(f"Test      : {len(test):,}\n")
        f.write(f"\nNote: Nowcast models achieve very low MAE because the 1-min\n")
        f.write(f"lag feature dominates. The FORECAST models are the honest\n")
        f.write(f"evaluation of how well we can predict from time + weather.\n")
    print(f"  Saved metrics -> {metrics_path}")

    # ---- Plots ----
    # Feature importance for best forecast model
    if hasattr(best_model, "feature_importances_"):
        plot_feature_importance(
            best_model, FEATURES_FORECAST,
            f"Feature Importance -- Forecast ({best_name})",
            OUT_DIR / "feature_importance.png",
        )

    # Also show nowcast importance for comparison
    nc_best = "Random Forest" if "Random Forest" in nc_models else list(nc_models.keys())[-1]
    nc_best_model = nc_models[nc_best]
    if hasattr(nc_best_model, "feature_importances_"):
        plot_feature_importance(
            nc_best_model, FEATURES_NOWCAST,
            f"Feature Importance -- Nowcast ({nc_best})",
            OUT_DIR / "feature_importance_nowcast.png",
        )

    # Predictions plot (forecast model)
    y_test = test[TARGET]
    plot_predictions(
        y_test.reset_index(drop=True),
        best_preds,
        test["timestamp"].reset_index(drop=True),
        f"Forecast ({best_name})",
        OUT_DIR / "predictions.png",
    )

    # Comparison bar chart
    plot_comparison(all_results, OUT_DIR / "model_comparison.png")

    # ---- Summary ----
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(all_df.to_string(index=False))
    print(f"\nBest forecast model saved: {best_name}")
    print("=" * 60)


if __name__ == "__main__":
    main()
