import sqlite3


def main() -> None:
    connection = sqlite3.connect('storage/db/app.sqlite')
    try:
        cursor = connection.cursor()
        rows = cursor.execute(
            'select id, title, status, parseStatus, originalFilePath from Paper order by updatedAt desc limit 10'
        ).fetchall()
    finally:
        connection.close()

    for row in rows:
        print(row)


if __name__ == '__main__':
    main()