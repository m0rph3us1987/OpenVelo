# Contributing to OpenVelo

First off, thank you for considering contributing to OpenVelo! It's people like you that make OpenVelo such a great tool.

This document provides a high-level overview of how to get your local environment set up, how the repository is structured, and how to submit your changes.

## 📁 Repository Structure

OpenVelo is structured as a monorepo containing three core components:

- **`components/web-ui`**: The central dashboard and Express/Vite server. This component orchestrates user sessions, manages the SQLite database, and acts as the bridge to the other components.
- **`components/orchestrator`**: The lifecycle manager for jobs. This spins up when a task is started and manages the execution flow.
- **`components/agent`**: The intelligent coding agent that executes tasks within isolated Docker containers.

## 🛠️ Local Development Setup

To run OpenVelo locally, you will need **Node.js (v18+)**, **Docker Desktop**, and **Git** installed on your system.

### 1. Clone the repository
```bash
git clone https://github.com/your-org/openvelo.git
cd openvelo
```

### 2. Configure Environment Variables
Copy the example environment file and configure it:
```bash
cp .env.example .env
```
Ensure that you set the `OPENVELO_DATA_DIR` inside the `.env` file to a persistent folder path on your local machine (e.g. `/home/user/openvelo-data` or `C:\openvelo-data`).

### 3. Install Dependencies
Run the install script from the repository root. This will automatically install dependencies for all three sub-components and rebuild native dependencies (like `better-sqlite3` and `node-pty`).
```bash
npm install
npm run postinstall
```

### 4. Run the Application
Start the Web UI in development mode. This spins up the Vite frontend and the Express backend concurrently.
```bash
npm run dev
```
The dashboard will be available at `http://localhost:5173`.

### 5. Build Docker Images (Required for Agent Execution)
Before you can run jobs through the UI, you need to build the local Docker images for the Orchestrator and the Agent:
```bash
npm run docker-build-all-linux
```

## 🧪 Testing

OpenVelo uses the native Node.js test runner (`tsx --test`). Tests are currently housed in the `components/web-ui/tests/` directory.

To run the test suite:
```bash
npm run test
```
To run the typechecker:
```bash
npm run typecheck --prefix components/web-ui
```

All tests and typechecks MUST pass before a Pull Request can be merged.

## 📝 Submitting a Pull Request

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally.
3. **Branch** out from `main` (`git checkout -b feature/my-awesome-feature`).
4. **Commit** your changes (`git commit -m "feat: added an awesome feature"`). Keep your commit messages descriptive.
5. **Push** to your branch (`git push origin feature/my-awesome-feature`).
6. **Open a Pull Request** against the `main` branch on the upstream repository.

When submitting a PR, ensure that:
- Your code passes all existing tests.
- You have added tests for any new functionality.
- You have updated relevant documentation (like `README.md` or prompts) if your changes affect user-facing features or agent behavior.

## 🐞 Reporting Bugs

If you find a bug in the source code, you can help us by submitting an issue to our GitHub Repository. Please include:
- Your operating system and Node/Docker versions.
- Steps to reproduce the issue.
- Relevant log output (check the Web UI console or the `docker logs` of the executing agent).

Thank you for contributing!
