"""HTML page routes for the Door2Dock dashboard."""

from flask import Blueprint, render_template

views = Blueprint("views", __name__)


@views.route("/")
def dashboard():
    return render_template("dashboard.html")


@views.route("/trends")
def trends():
    return render_template("trends.html")


@views.route("/weather-impact")
def weather_impact():
    return render_template("weather_impact.html")


@views.route("/planner")
def planner():
    return render_template("planner.html")


@views.route("/about")
def about():
    return render_template("about.html")
