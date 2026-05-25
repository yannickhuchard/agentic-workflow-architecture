"""
AWA SQLite Database Persistence Management
"""

import os
import sqlite3
from typing import Generator


# Default database location is awa.db in the current workspace directory
DB_PATH = os.environ.get("AWA_DATABASE_URL", "awa.db")


def get_connection() -> sqlite3.Connection:
    """Get a database connection with dictionary row factory enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Initialize SQLite database schema for human tasks and workflow executions."""
    conn = get_connection()
    cursor = conn.cursor()

    # Create human_tasks table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS human_tasks (
        id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL,
        activity_name TEXT NOT NULL,
        token_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority TEXT NOT NULL DEFAULT 'normal',
        assignee_id TEXT,
        role_id TEXT NOT NULL,
        creator_id TEXT,
        creator_type TEXT,
        assigner_id TEXT,
        assigner_type TEXT,
        inputs TEXT NOT NULL,          -- JSON string
        outputs TEXT,                 -- JSON string
        created_at TEXT NOT NULL,     -- ISO datetime string
        updated_at TEXT NOT NULL,     -- ISO datetime string
        due_at TEXT,                  -- ISO datetime string
        completed_at TEXT,            -- ISO datetime string
        description TEXT,
        form_schema TEXT,             -- JSON string
        tags TEXT                     -- JSON string array
    )
    """)

    # Create workflow_executions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS workflow_executions (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,     -- ISO datetime string
        completed_at TEXT NOT NULL,   -- ISO datetime string
        duration_ms INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        execution_cost REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'USD',
        steps_count INTEGER NOT NULL DEFAULT 0,
        user_id TEXT,
        metadata TEXT                 -- JSON string
    )
    """)

    conn.commit()
    conn.close()


# Auto-initialize database on import
init_db()
