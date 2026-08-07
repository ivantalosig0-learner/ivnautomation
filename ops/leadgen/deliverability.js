/*
 * deliverability.js — sending windows, warmup ramp, jitter and the circuit
 * breaker (§5.2). Pure functions; the dispatcher applies them.
 *
 * The measured problem this fixes: the configured daily cap was 15 and 50
 * emails went out on 2026-08-06, from a single mailbox on the primary business
 * domain, with no bounce feedback of any kind. One bad run on a primary domain
 * costs the business its ordinary email, not just its outreach.
 */
module.exports.DELIVERABILITY_SRC = String.raw`
// ---------- KQuality deliverability controls v1 ----------

var KQ_TZ = 'Australia/Adelaide';

/*
 * Adelaide wall-clock parts for an instant. Intl carries the real tzdata, so
 * the ACST/ACDT switch (first Sunday in October / first Sunday in April, 02:00
 * local) is handled by definition rather than by a hand-rolled rule that goes
 * stale. The fallback exists only for a build without full ICU.
 */
function kqdParts(when) {
  var d = (when instanceof Date) ? when : new Date(when || Date.now());
  try {
    var fmt = new Intl.DateTimeFormat('en-AU', {
      timeZone: KQ_TZ, hour12: false, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var p = {};
    var parts = fmt.formatToParts(d);
    for (var i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
    var dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      year: Number(p.year), month: Number(p.month), day: Number(p.day),
      hour: Number(p.hour === '24' ? '00' : p.hour), minute: Number(p.minute),
      second: Number(p.second), dow: dowMap[p.weekday],
      offset_minutes: kqdOffsetMinutes(d)
    };
  } catch (e) {
    return kqdPartsFallback(d);
  }
}

// Offset by comparing the same instant formatted in UTC and in Adelaide.
function kqdOffsetMinutes(d) {
  try {
    var f = function (tz) {
      var o = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).formatToParts(d);
      var m = {};
      for (var i = 0; i < o.length; i++) m[o[i].type] = o[i].value;
      return Date.UTC(+m.year, +m.month - 1, +m.day,
                      +(m.hour === '24' ? 0 : m.hour), +m.minute, +m.second);
    };
    return Math.round((f(KQ_TZ) - f('UTC')) / 60000);
  } catch (e) {
    return kqdIsDstFallback(d) ? 630 : 570;
  }
}

/*
 * South Australian DST rule, used only if Intl is unavailable: ACDT (+10:30)
 * from 02:00 on the first Sunday in October to 03:00 on the first Sunday in
 * April, otherwise ACST (+9:30).
 */
function kqdFirstSundayUtc(year, month) {   // month 1-12, returns UTC ms at 00:00 UTC
  var d = new Date(Date.UTC(year, month - 1, 1));
  var add = (7 - d.getUTCDay()) % 7;
  return Date.UTC(year, month - 1, 1 + add);
}
function kqdIsDstFallback(d) {
  var t = d.getTime();
  var y = d.getUTCFullYear();
  // Transitions expressed as UTC instants: 02:00 ACST = 16:30 UTC previous day.
  var octStart = kqdFirstSundayUtc(y, 10) + (2 * 60 - 570) * 60000;
  var aprEnd   = kqdFirstSundayUtc(y, 4)  + (3 * 60 - 630) * 60000;
  if (t < aprEnd) return true;              // Jan-Mar, still ACDT
  if (t >= octStart) return true;           // Oct-Dec
  return false;
}
function kqdPartsFallback(d) {
  var off = kqdIsDstFallback(d) ? 630 : 570;
  var l = new Date(d.getTime() + off * 60000);
  return {
    year: l.getUTCFullYear(), month: l.getUTCMonth() + 1, day: l.getUTCDate(),
    hour: l.getUTCHours(), minute: l.getUTCMinutes(), second: l.getUTCSeconds(),
    dow: l.getUTCDay(), offset_minutes: off
  };
}

function kqdMinutesOfDay(hhmm) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/*
 * Adelaide business hours, Mon-Fri. Sending at 21:00 local reads as automated
 * even when the copy does not.
 */
function kqdInSendWindow(when, startHHMM, endHHMM) {
  var p = kqdParts(when);
  if (p.dow === 0 || p.dow === 6) return false;
  var start = kqdMinutesOfDay(startHHMM || '08:00');
  var end = kqdMinutesOfDay(endHHMM || '16:30');
  var now = p.hour * 60 + p.minute;
  return now >= start && now < end;
}

// Instant for a given Adelaide wall-clock time on a given local date.
function kqdLocalToInstant(year, month, day, hour, minute) {
  // Guess at ACST, then correct with the offset that actually applies there.
  var guess = Date.UTC(year, month - 1, day, hour, minute) - 570 * 60000;
  var off = kqdOffsetMinutes(new Date(guess));
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - off * 60000);
}

/*
 * The next moment inside the window at or after the given instant. Rolls over
 * evenings and weekends, and lands correctly on the two days a year the clock
 * moves because the offset is recomputed for the target date.
 */
function kqdNextSendSlot(when, startHHMM, endHHMM) {
  var start = kqdMinutesOfDay(startHHMM || '08:00');
  var end = kqdMinutesOfDay(endHHMM || '16:30');
  var cursor = (when instanceof Date) ? new Date(when.getTime()) : new Date(when || Date.now());
  for (var guard = 0; guard < 14; guard++) {
    var p = kqdParts(cursor);
    var mins = p.hour * 60 + p.minute;
    var weekday = p.dow >= 1 && p.dow <= 5;
    if (weekday && mins >= start && mins < end) return cursor;
    if (weekday && mins < start) {
      return kqdLocalToInstant(p.year, p.month, p.day, Math.floor(start / 60), start % 60);
    }
    // Past the window or a weekend: move to 00:00 of the next local day and
    // re-test, so the DST offset for that day is picked up fresh.
    var nextUtc = Date.UTC(p.year, p.month - 1, p.day) + 86400000;
    var n = new Date(nextUtc);
    cursor = kqdLocalToInstant(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(),
                               Math.floor(start / 60), start % 60);
  }
  return cursor;
}

// Step N of the sequence is day_offset days after step 1, snapped into the
// next business-hours slot.
function kqdStepDueAt(startedAt, dayOffset, startHHMM, endHHMM) {
  var base = (startedAt instanceof Date) ? startedAt : new Date(startedAt);
  var t = new Date(base.getTime() + Number(dayOffset || 0) * 86400000);
  return kqdNextSendSlot(t, startHHMM, endHHMM);
}

/*
 * Randomised gaps between sends. A burst of 40 identical-interval messages is
 * the single most obvious automation signature there is.
 */
function kqdJitterSeconds(minS, maxS) {
  var lo = Number(minS == null ? 90 : minS);
  var hi = Number(maxS == null ? 600 : maxS);
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/*
 * Warmup ramp: 10/day on the first day, +5/day, hard cap 40/mailbox/day.
 * Mirrors leads.mailbox_daily_cap() so the dispatcher and the DB agree.
 */
function kqdWarmupCap(warmupStartedOn, today, floor, step, max) {
  var f = Number(floor == null ? 10 : floor);
  var st = Number(step == null ? 5 : step);
  var mx = Number(max == null ? 40 : max);
  if (!warmupStartedOn) return f;
  var a = new Date(String(warmupStartedOn).slice(0, 10) + 'T00:00:00Z').getTime();
  var b = new Date(String(today || new Date().toISOString()).slice(0, 10) + 'T00:00:00Z').getTime();
  var days = Math.max(0, Math.round((b - a) / 86400000));
  return Math.min(mx, f + st * days);
}

/*
 * Circuit breaker (§5.2). Rolling 7-day hard bounce > 3% or complaints > 0.1%
 * pauses the mailbox. Non-negotiable: this is what stops one bad list from
 * costing the business its domain reputation.
 *
 * A minimum sample is required so that 1 bounce in the first 3 sends of a
 * warmup does not read as 33% and pause a healthy mailbox on day one.
 */
function kqdBreaker(stats, cfg) {
  stats = stats || {};
  cfg = cfg || {};
  var sent = Number(stats.sent_7d || 0);
  var hard = Number(stats.hard_bounce_7d || 0);
  var comp = Number(stats.complaint_7d || 0);
  var minSample = Number(cfg.min_sample == null ? 20 : cfg.min_sample);
  var bouncePct = sent ? (100 * hard / sent) : 0;
  var compPct = sent ? (100 * comp / sent) : 0;
  var maxBounce = Number(cfg.hard_bounce_pct == null ? 3.0 : cfg.hard_bounce_pct);
  var maxComp = Number(cfg.complaint_pct == null ? 0.1 : cfg.complaint_pct);

  // A complaint is serious enough that two of them trip regardless of sample.
  if (comp >= 2 && compPct > maxComp) {
    return { trip: true, reason: 'complaint_rate', value: Number(compPct.toFixed(3)),
             threshold: maxComp, sent_7d: sent };
  }
  if (sent < minSample) {
    return { trip: false, reason: 'below_min_sample', value: null, sent_7d: sent };
  }
  if (bouncePct > maxBounce) {
    return { trip: true, reason: 'hard_bounce_rate', value: Number(bouncePct.toFixed(2)),
             threshold: maxBounce, sent_7d: sent };
  }
  if (compPct > maxComp) {
    return { trip: true, reason: 'complaint_rate', value: Number(compPct.toFixed(3)),
             threshold: maxComp, sent_7d: sent };
  }
  return { trip: false, reason: 'healthy', value: Number(bouncePct.toFixed(2)), sent_7d: sent };
}

/*
 * How many sends this mailbox may still make today. The queue is capped by
 * deliverability, never by queue depth (§4.5).
 */
function kqdRemainingToday(mailbox, sentToday) {
  var m = mailbox || {};
  if (m.status === 'paused' || m.enabled === false) return 0;
  var cap = kqdWarmupCap(m.warmup_started_on, new Date().toISOString(),
                         m.daily_cap_floor, m.warmup_step, m.daily_cap_max);
  if (m.status === 'active' && !m.warmup_started_on) cap = Number(m.daily_cap_max || 40);
  return Math.max(0, cap - Number(sentToday || 0));
}
// ---------- end deliverability controls ----------
`;
