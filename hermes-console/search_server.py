import json,subprocess,re
from http.server import BaseHTTPRequestHandler,HTTPServer
from urllib.parse import urlparse,parse_qs

def run_search(q, limit=8):
    q=(q or "").strip()[:200]
    if not q: return []
    try:
        out=subprocess.run(["qmd","search",q],capture_output=True,text=True,timeout=20).stdout
    except Exception as e:
        return [{"file":"(error)","score":"","snippet":str(e)}]
    results=[];cur=None
    for line in out.splitlines():
        m=re.match(r"^qmd://([^\s]+)",line)
        if m:
            if cur:results.append(cur)
            cur={"file":m.group(1),"score":"","snippet":""}
        elif cur is not None:
            sm=re.match(r"^Score:\s*(.+)$",line.strip())
            if sm and not cur["score"]:cur["score"]=sm.group(1).strip()
            elif line.startswith("Title:"):pass
            else:
                if len(cur["snippet"])<600:cur["snippet"]+=line+"\n"
    if cur:results.append(cur)
    for r in results:r["snippet"]=r["snippet"].strip()[:600]
    return results[:limit]

class H(BaseHTTPRequestHandler):
    def _send(self,code,obj):
        b=json.dumps(obj).encode();self.send_response(code)
        self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(b)));self.end_headers();self.wfile.write(b)
    def do_GET(self):
        u=urlparse(self.path)
        if u.path=="/health":return self._send(200,{"ok":True})
        if u.path=="/search":
            q=(parse_qs(u.query).get("q") or [""])[0]
            return self._send(200,{"ok":True,"results":run_search(q)})
        self._send(404,{"ok":False})
    def log_message(self,*a):pass

if __name__=="__main__":
    HTTPServer(("0.0.0.0",8899),H).serve_forever()
