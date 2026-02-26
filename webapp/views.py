"""HTML page routes for the Door2Dock dashboard."""

from flask import Blueprint, render_template

views = Blueprint("views", __name__)


@views.route("/")
def dashboard():
    return render_template("dashboard.html")


@views.route("/timeseries")
def timeseries():
    return render_template("timeseries.html")


@views.route("/heatmap")
def heatmap():
    return render_template("heatmap.html")


@views.route("/weather")
def weather():
    return render_template("weather.html")


@views.route("/planner")
def planner():
    return render_template("planner.html")


@views.route("/about")
def about():
    return render_template("about.html")
