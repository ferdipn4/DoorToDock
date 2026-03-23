"""HTML page routes for the Door2Dock app."""

from flask import Blueprint, render_template, redirect, request

views = Blueprint("views", __name__)


@views.route("/")
def index():
    return render_template("home.html", active_tab="home")


@views.route("/go")
def go():
    timing = request.args.get("timing", "now")
    return render_template("go.html", active_tab="go", active_timing=timing)


@views.route("/map")
def map_tab():
    return redirect("/go?timing=now")


@views.route("/insights")
def insights():
    return render_template("insights.html", active_tab="insights")


@views.route("/settings")
def settings():
    return render_template("settings.html", active_tab="settings")
