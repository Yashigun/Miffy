# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Miffy is an AI-powered medical assistant platform. It's a microservices-based monorepo with four independently running services: a React frontend, a main Express backend, an authentication microservice, and a chatbot service powered by Google Gemini.

## Architecture

**Services and ports:**

| Service | Path | Port | Purpose |
|---------|------|------|---------|
| Main Frontend | `frontend/` | Vite default | React 19 SPA with Tailwind CSS 4 |
| Main Backend | `backend/` | 4000 | Express 5 + MongoDB (doctors, admin, uploads) |
| Auth Server | `backend/authServer/` | 5000 | JWT auth microservice (login/signup) |
| Chatbot Server | `MediMateBot/server/` | 8080 | Gemini 1.5 Flash API wrapper |
| Chatbot Client | `MediMateBot/client/` | Vite default | Separate React app for chat UI |

**Auth flow:** Login form → POST `/auth/login` → JWT returned → stored in `localStorage` (`token`, `loggedInUser`) → checked by `RefreshHandler` on page load → protected routes redirect unauthenticated users to `/login`.

**Frontend routing** is defined in `frontend/src/App.jsx`. Protected routes use a `PrivateRoute` wrapper that checks `isAuthenticated` state. Page transitions use Framer Motion via `AnimatedPage.jsx`.

**Backend patterns:**
- `backend/authServer/` has its own models, controllers, routes, and middleware — it's a separate Express app with its own MongoDB connection
- `backend/` (main) uses Mongoose models in `models/`, controllers in `controllers/`, and routes in `routes/`
- File uploads go through Multer middleware → Cloudinary
- Auth server validates input with Joi schemas

**Note:** The auth middleware folder has a typo: `backend/authServer/middlerwares/` (not `middlewares`).

## Development Commands

All services must run simultaneously. Each needs its own terminal:

```bash
# Frontend (main)
cd frontend && npm run dev

# Main backend (with auto-reload)
cd backend && npm run server

# Auth server (with auto-reload)
cd backend/authServer && npm run dev

# Chatbot backend
cd MediMateBot/server && npm start

# Chatbot frontend
cd MediMateBot/client && npm run dev
```

**Build & lint (frontend only):**
```bash
cd frontend && npm run build
cd frontend && npm run lint
```

## Environment Variables

Three `.env` files are required (none committed to repo):

- `backend/.env` — `MONGODB_URI`, `CLOUDINARY_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_SECRET_KEY`, `PORT`
- `backend/authServer/.env` — `MONGO_URI`, `JWT_SECRET`, `PORT`
- `MediMateBot/server/.env` — `GEMINI_API_KEY`

## Key Tech Stack

- **Frontend:** React 19, Vite 7, Tailwind CSS 4, React Router 7, Framer Motion, Leaflet (maps), Axios
- **Backend:** Express 5, Mongoose/MongoDB, JWT + Bcrypt, Multer + Cloudinary, Joi validation
- **AI:** Google Gemini 1.5 Flash via `@google/generative-ai`

## Important Patterns

- All backend services use ES modules (`"type": "module"` in package.json)
- The main user model in `backend/models/userModel.js` is very large (~59KB) with extensive medical data fields
- The chatbot enforces a structured response format (Severity, Immediate Need, See a Doctor If, Next Steps, Possible Conditions) via Gemini system instructions
- Map component (`frontend/src/pages/MapComponent.jsx`) uses OpenStreetMap + Overpass API for nearby hospitals/pharmacies within 5km, with IP geolocation fallback
- SOS button in NavBar uses GPS geolocation with IP-based fallback (`ipapi.co`)
