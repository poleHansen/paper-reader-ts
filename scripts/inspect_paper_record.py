import json
import sqlite3
import sys


def main() -> int:
    paper_id = sys.argv[1]
    conn = sqlite3.connect('storage/db/app.sqlite')
    conn.row_factory = sqlite3.Row

    print('PAPER')
    for row in conn.execute(
        'select id, title, originalFilePath, status, parseStatus from Paper where id = ?',
        (paper_id,),
    ):
        print(json.dumps(dict(row), ensure_ascii=False))

    print('SECTIONS')
    for row in conn.execute(
        'select title, sectionType, pageStart, pageEnd, substr(content, 1, 500) as content from PaperSection where paperId = ? order by orderNo limit 10',
        (paper_id,),
    ):
        print(json.dumps(dict(row), ensure_ascii=False))

    print('FIGURES')
    for row in conn.execute(
        'select label, figureType, pageNo, substr(caption, 1, 300) as caption, substr(contextBefore, 1, 200) as before_ctx, substr(contextAfter, 1, 200) as after_ctx from PaperFigure where paperId = ? order by orderNo limit 10',
        (paper_id,),
    ):
        print(json.dumps(dict(row), ensure_ascii=False))

    print('REFERENCES')
    count = conn.execute('select count(*) from ReferenceItem where paperId = ?', (paper_id,)).fetchone()[0]
    print(count)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())