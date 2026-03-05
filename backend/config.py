import os

CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "skeleton_clean.csv")
HOST = "127.0.0.1"
PORT = 3000
CORS_ORIGINS = ["*"]
STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "web", "dist")
