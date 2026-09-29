# Stage 0: a tiny FastAPI app that just proves hosting works.
# Later stages will add templates, login, and the database.

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

# Create the web app (FastAPI is the framework that handles web requests)
app = FastAPI()


# Home page: shows a simple "alive" message in the browser
@app.get("/", response_class=HTMLResponse)
def home():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Pastel Planner</title>
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #FDFBF7;
          color: #3A3128;
          font-family: system-ui, sans-serif;
          text-align: center;
        }
        h1 { font-family: Georgia, serif; font-weight: 500; }
        p { color: #6E6152; }
      </style>
    </head>
    <body>
      <main>
        <h1>Pastel Planner is alive</h1>
        <p>Your Space is running. On to Stage 1.</p>
      </main>
    </body>
    </html>
    """


# Health check: a tiny JSON answer, handy for testing the server is up
@app.get("/health")
def health():
    return {"status": "ok"}
