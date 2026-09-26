# Reading the usage counts

The app counts eight anonymous events (see [analytics-proposal.md](analytics-proposal.md)
for what and why). They land in Cloudflare **Workers Analytics Engine**, dataset
`manim_usage`, kept three months. Nothing to set up: the dataset is created by the
first count after a deploy.

Each row: `blob1` = event, `blob2` / `blob3` = its two details, `double1` = 1.

| event | blob2 | blob3 |
|---|---|---|
| `landing` | phone / desktop | — |
| `new_call` | phone / desktop | — |
| `prejoin` | `new` / `link` | phone / desktop |
| `joined` | `cam_on` / `cam_off` | `low_on` / `low_off` |
| `left` | `lt1` `1-5` `5-15` `15-30` `30-60` `60plus` (minutes) | phone / desktop |
| `knock_rejected` | reason (`host_denied`, `timed_out`, `locked`, `link_expired`, …) | — |
| `permission_denied` | `camera` / `mic` / `both` | phone / desktop |
| `join_error` | `permission` / `network` / `server` / `seat_taken` / `other` | phone / desktop |

## Run a query

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token** → Custom, permission
   **Account · Account Analytics · Read**. Copy it.
2. Your account id is in the dashboard URL (`dash.cloudflare.com/<account id>/…`).
3. In a terminal:

```bash
ACCOUNT_ID=your-account-id
TOKEN=your-token
q() { curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $TOKEN" --data "$1"; }
```

**The join funnel, last 7 days**

```bash
q "SELECT blob1 AS event, SUM(_sample_interval * double1) AS n
   FROM manim_usage
   WHERE timestamp > NOW() - INTERVAL '7' DAY
     AND blob1 IN ('landing', 'prejoin', 'joined', 'left')
   GROUP BY event ORDER BY n DESC"
```

**Why people didn't get in**

```bash
q "SELECT blob1 AS event, blob2 AS why, SUM(_sample_interval * double1) AS n
   FROM manim_usage
   WHERE timestamp > NOW() - INTERVAL '30' DAY
     AND blob1 IN ('knock_rejected', 'join_error', 'permission_denied')
   GROUP BY event, why ORDER BY n DESC"
```

**How long calls last**

```bash
q "SELECT blob2 AS minutes, SUM(_sample_interval * double1) AS n
   FROM manim_usage
   WHERE timestamp > NOW() - INTERVAL '30' DAY AND blob1 = 'left'
   GROUP BY minutes ORDER BY n DESC"
```

Local and test runs send nothing: counting is on in production builds only.
