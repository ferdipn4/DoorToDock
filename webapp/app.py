"""Door2Dock – Smart-Commute Dashboard Flask App."""

import os
from flask import Flask
from flask_caching import Cache
from flask_compress import Compress

cache = Cache()
compress = Compress()


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-key-door2dock")
    app.config["CACHE_TYPE"] = "SimpleCache"
    app.config["CACHE_DEFAULT_TIMEOUT"] = 60

    cache.init_app(app)
    compress.init_app(app)

    from webapp.api import api
    from webapp.views import views
    app.register_blueprint(api)
    app.register_blueprint(views)

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
