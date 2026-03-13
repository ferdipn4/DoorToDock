"""HTML page routes for the Door2Dock dashboard."""

from flask import Blueprint, render_template

views = Blueprint("views", __name__)


@views.route("/")
def now():
    return render_template("now.html")


@views.route("/plan")
def plan():
    return render_template("plan.html")


@views.route("/insights")
def insights():
    return render_template("insights.html")
