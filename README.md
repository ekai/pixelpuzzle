# Pixel Canvas

A collaborative pixel grid inspired by the Million Dollar Home Page. Draw up to 5 connecting pixels per day—your session, your colors.

## How It Works

- **500×500 pixel grid** — A shared canvas for everyone
- **5 pixels per day** — Each IP can place up to 5 new pixels per day
- **Connecting pixels** — New pixels must be adjacent (including diagonally) to your existing pixels
- **Color picker** — Choose any color for your pixels
- **Session-based** — Change colors freely while your session is active; pixels lock when the session ends (30 min inactivity or "End Session")

## Run Locally

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Tech Stack

- **Backend:** Node.js, Express, SQLite (better-sqlite3)
- **Frontend:** Vanilla HTML/CSS/JS, Canvas API
