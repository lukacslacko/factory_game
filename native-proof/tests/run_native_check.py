"""Run exactly one native Godot check with a time and resident-memory watchdog."""
import argparse
import json
import pathlib
import subprocess
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument("--timeout", type=int, default=55)
parser.add_argument("--name", default="native-check")
parser.add_argument("--sample-after",type=int,default=0)
parser.add_argument("godot_args", nargs=argparse.REMAINDER)
args = parser.parse_args()
project = pathlib.Path(__file__).resolve().parents[1]
output = project / "captures" / (args.name + ".log")
output.parent.mkdir(exist_ok=True)
extra = args.godot_args[1:] if args.godot_args[:1] == ["--"] else args.godot_args
command = ["/Applications/Godot.app/Contents/MacOS/Godot", "--path", str(project), "--log-file", str(project / "captures" / (args.name + "-engine.log")), *extra]
peak_rss = 0
start = time.monotonic()
reason = None
sampled = False
with output.open("w") as log:
    process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
    print("Native check PID", process.pid, flush=True)
    while process.poll() is None:
        if time.monotonic() - start > args.timeout:
            reason = "timeout"
            break
        stats = subprocess.run(["/bin/ps", "-o", "rss=", "-p", str(process.pid)], capture_output=True, text=True)
        if stats.returncode == 0 and stats.stdout.strip():
            peak_rss = max(peak_rss, int(stats.stdout.strip()) * 1024)
        if peak_rss > 2_000_000_000:
            reason = "resident memory exceeded 2 GB"
            break
        if args.sample_after and not sampled and time.monotonic()-start > args.sample_after:
            sampled = True
            subprocess.run(["/usr/bin/sample",str(process.pid),"1","1","-file",str(project / "captures" / (args.name+"-stack.txt"))],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
        time.sleep(0.5)
    if reason:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        print("Stopped:", reason, flush=True)
print(output.read_text(), flush=True)
report = {"name": args.name, "elapsed_seconds": round(time.monotonic()-start, 2), "peak_resident_bytes": peak_rss, "returncode": process.returncode, "stopped_reason": reason}
(project / "captures" / (args.name + "-resources.json")).write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report), flush=True)
sys.exit(1 if reason or process.returncode else 0)
