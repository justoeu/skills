from collections import OrderedDict
import time

class Budget:
    def __init__(self):
        self.users = OrderedDict()
        self.tick = 0
        self.total = 0
    def allow(self, uid):
        tick = int(time.monotonic())
        if self.tick != tick:
            self.tick = tick; self.total = 0; self.users.clear()
        count = self.users.get(uid, 0)
        if self.total >= 8 or count >= 2: return False
        self.total += 1; self.users[uid] = count + 1
        return True
budget = Budget()
jobs = []
accounts = {}
cache = {}

def authenticate(req):
    return req.get("session") == "valid"
def enqueue(body):
    jobs.append(dict(body))
    return 202

def middleware(req, handler):
    if not authenticate(req): return 401
    if not budget.allow(req["user_id"]): return 429
    return handler(req)

def order(req):
    enqueue({"order": req["body"]})
    return 202

def receipt(req):
    if not authenticate(req): return 401
    if not budget.allow(req["user_id"]): return 429
    return enqueue({"receipt": req["body"]})

def upload(req):
    if len(req["body"]) > 2048: return 413
    return enqueue({"upload": req["body"]})

def dispatch(req):
    if req.get("credential") != "valid": return 401
    return enqueue({"email": req["body"]})

def register(req):
    uid = len(accounts) + 1
    accounts[uid] = req["body"]
    cache[uid] = {"quota": 0}
    return uid

ROUTES = {
    ("POST", "/orders"): lambda req: middleware(req, order),
    ("POST", "/receipts"): receipt,
    ("POST", "/uploads"): upload,
    ("POST", "/dispatch"): dispatch,
    ("POST", "/register"): register,
}
