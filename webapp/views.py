"""HTML page routes for the DockSense app."""

from flask import Blueprint, render_template, redirect

views = Blueprint("views", __name__)


@views.route("/")
def index():
    return redirect("/go")


@views.route("/go")
def go():
    return render_template("go.html", active_tab="go")


@views.route("/map")
def map_tab():
    return render_template("map_tab.html", active_tab="map")


@views.route("/insights")
def insights():
    return render_template("insights.html", active_tab="insights")


@views.route("/settings")
def settings():
    return render_template("settings.html", active_tab="settings")
