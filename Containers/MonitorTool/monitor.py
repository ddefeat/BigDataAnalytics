import csv, functools, http.server, math, os, statistics, threading, time
from pymongo import MongoClient
from pymongo.errors import PyMongoError

# consts
HOST = os.environ.get("DBHOST", "localhost")
INTERVAL = float(os.environ.get("INTERVAL", "5"))
HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, "samples.csv")
COLS = ["files", "chunks", "candidates", "clones"]

# db
db = MongoClient(HOST, 27017, serverSelectionTimeoutMS=5000)["cloneDetector"]


def r_squared(xs, ys):
    return statistics.correlation(xs, ys) ** 2


def report(rows):
    """Print whether the time to create a new unit goes up or down as more
    units exist, and whether a linear or an exponential curve fits better."""
    for i, c in enumerate(COLS, start=1):
        pts = [(b[i], (b[0] - a[0]) / (b[i] - a[i]))
               for a, b in zip(rows, rows[1:]) if b[i] > a[i]]
        if len(pts) < 5:
            continue
        ns, ps = zip(*pts)
        try:
            slope = statistics.linear_regression(ns, ps).slope
            lin = r_squared(ns, ps)
            exp = r_squared(ns, [math.log(p) for p in ps])
        except statistics.StatisticsError:
            continue
        print(f"[stats] {c}: time/unit {'increases' if slope > 0 else 'decreases'} "
              f"with n (slope {slope:.3g} s/unit per unit); "
              f"R2 linear={lin:.3f} exponential={exp:.3f} -> "
              f"{'linear' if lin >= exp else 'exponential'} fits better", flush=True)


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=HERE)
    handler.log_message = lambda *a: None
    http.server.ThreadingHTTPServer(("", 8000), handler).serve_forever()


def main():
    threading.Thread(target=serve, daemon=True).start()
    rows, last_id = [], None
    with open(CSV, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["t"] + COLS)
        while True:
            try:
                counts = [db[c].estimated_document_count() for c in COLS]
                rows.append([time.time()] + counts)
                w.writerow(rows[-1])
                f.flush()
                print(time.strftime("%H:%M:%S"), dict(zip(COLS, counts)), flush=True)
                q = {"_id": {"$gt": last_id}} if last_id else {}
                for u in db.statusUpdates.find(q).sort("_id", 1):
                    print("[update]", u["timestamp"], u["message"], flush=True)
                    last_id = u["_id"]
                if len(rows) % 12 == 0:
                    report(rows)
            except PyMongoError as e:
                print("db not available:", e, flush=True)
            time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
