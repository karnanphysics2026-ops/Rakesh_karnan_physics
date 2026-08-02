import os
import sys
import subprocess
from pathlib import Path

def install_and_import(package, import_name=None):
    if import_name is None:
        import_name = package
    try:
        __import__(import_name)
    except ImportError:
        print(f"Installing {package} database package...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])

# Attempt to install psycopg2-binary
try:
    install_and_import("psycopg2-binary", "psycopg2")
    import psycopg2 as pg_driver
    use_psycopg = True
except Exception:
    # Fallback to pure-python pg8000
    install_and_import("pg8000")
    import pg8000 as pg_driver
    use_psycopg = False

def main():
    print("=== Supabase Database Migration Runner ===")
    
    # Get database connection URI
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("\nPlease enter your Supabase Connection URI (from Project Settings -> Database -> Connection string -> URI).")
        print("Format: postgres://postgres.[PROJECT_ID]:[PASSWORD]@db.[PROJECT_ID].supabase.co:5432/postgres")
        db_url = input("\nConnection URI: ").strip()

    if not db_url:
        print("Error: Connection URI is required.")
        return 1

    # Connect to PostgreSQL
    print("\nConnecting to Supabase...")
    try:
        if use_psycopg:
            conn = pg_driver.connect(db_url)
        else:
            # Parse connection URI for pg8000
            parts = db_url.split("://")[1].split("@")
            auth = parts[0].split(":")
            user = auth[0]
            password = auth[1] if len(auth) > 1 else ""
            host_port_db = parts[1].split("/")
            host_port = host_port_db[0].split(":")
            host = host_port[0]
            port = int(host_port[1]) if len(host_port) > 1 else 5432
            database = host_port_db[1].split("?")[0]
            conn = pg_driver.connect(
                user=user,
                password=password,
                host=host,
                port=port,
                database=database,
                ssl_context=True
            )
        cursor = conn.cursor()
        print("Connected successfully!")
    except Exception as e:
        print(f"Connection failed: {e}")
        return 1

    # Find SQL migration files
    migrations_dir = Path(__file__).resolve().parents[1] / "supabase" / "migrations"
    migration_files = sorted(migrations_dir.glob("*.sql"))

    if not migration_files:
        print(f"Error: No SQL files found in {migrations_dir}")
        conn.close()
        return 1

    print(f"Found {len(migration_files)} migration files to apply.")

    # Apply migrations
    for sql_file in migration_files:
        print(f"Applying {sql_file.name}...", end="", flush=True)
        try:
            sql_content = sql_file.read_text(encoding="utf-8")
            
            # Execute entire file contents (handles multi-statement transactions)
            cursor.execute(sql_content)
            conn.commit()
            print(" [OK]")
        except Exception as e:
            conn.rollback()
            print(" [FAILED]")
            print(f"Error applying {sql_file.name}: {e}")
            confirm = input("Do you want to skip this migration and continue? (y/n): ").strip().lower()
            if confirm != 'y':
                conn.close()
                return 1

    print("\nAll database tables and schemas applied successfully!")
    conn.close()
    return 0

if __name__ == "__main__":
    sys.exit(main())
