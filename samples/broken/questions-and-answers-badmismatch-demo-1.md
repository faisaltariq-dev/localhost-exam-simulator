---
exam_maker: badmismatch
exam_name: demo
exam_number: 2
title: Sample Demo – Cloud Data Basics
duration_minutes: 10
domain_count: 3
---

# Domains

- D1: Data Ingestion and Preparation
- D2: Data Analysis and Presentation
- D3: Data Management and Governance

# Questions

## Q1
A team receives a CSV export in a Cloud Storage bucket every night. Analysts need the data in BigQuery as soon as each file lands, with as little operational work as possible. What should the team do?

- A) Schedule a BigQuery Data Transfer Service run for 06:00 every day.
- B) Trigger a BigQuery load job from the Cloud Storage object-finalize event.
- C) Build a Dataflow streaming pipeline that reads from the bucket.
- D) Copy the files to a Compute Engine VM and load them with a cron job.

## Q2
An analyst runs this query and is billed for scanning the whole table every time:

```sql
SELECT order_id, total
FROM shop.orders
WHERE order_date = '2026-10-01';
```

The table holds three years of orders. Which change reduces the bytes scanned the most?

- A) Add `LIMIT 100` to the query.
- B) Partition the table by `order_date`.
- C) Select `*` instead of two columns so the cache is reused.
- D) Cluster the table by `order_id`.

## Q3
A product manager wants a dashboard on top of BigQuery that refreshes automatically and can be shared with people outside the data team. Which tool fits best with the least setup?

- A) Looker Studio
- B) A scheduled query that writes a CSV to Cloud Storage
- C) Vertex AI Workbench
- D) Cloud Monitoring dashboards

## Q4
A dataset contains customer email addresses. Analysts need to join on the email column but must not see the raw values. What should you use?

- A) Grant analysts the BigQuery Data Viewer role on the dataset.
- B) Store the emails in a separate project.
- C) Apply a data masking policy with a hash (SHA-256) rule to the column.
- D) Export the table to Cloud Storage with customer-managed encryption keys.

## Q5
Raw event files must be kept for seven years for audit purposes and are almost never read. Which Cloud Storage class is the most cost-effective?

- A) Standard
- B) Nearline
- C) Coldline
- D) Archive

## Q6
A pipeline cleans incoming records and must drop rows where `country` is empty before loading them into BigQuery. The team wants a visual, low-code tool. What should they use?

- A) Cloud Data Fusion
- B) Cloud Composer
- C) Pub/Sub
- D) Bigtable

# Answers

## Q1
Answer: B
Domain: D1
Explanation: An object-finalize event fires the load as soon as each file arrives, with nothing to run or schedule.
A waits until 06:00. C is a streaming pipeline you have to operate for a once-a-day file. D adds a VM to manage.

## Q2
Answer: B
Domain: D2
Explanation: Partitioning by `order_date` lets BigQuery prune to a single day's partition. A does not reduce bytes scanned. C scans more columns. D helps filters on `order_id`, not on the date.

## Q3
Answer: A
Domain: D2
Explanation: Looker Studio connects directly to BigQuery, refreshes on its own and can be shared by link. B produces files, not a dashboard. C is a notebook environment. D is for system metrics.

## Q4
Answer: C
Domain: D3
Explanation: A hash masking rule keeps values joinable while hiding the raw email. A shows raw values. B and D control location and encryption, not what analysts can see.

## Q5
Answer: D
Domain: D3
Explanation: Archive has the lowest storage price and suits data read less than once a year. Its retrieval cost doesn't matter for files that are almost never read.

## Q6
Answer: A
Domain: D1
Explanation: Cloud Data Fusion is a visual, low-code integration tool with built-in transforms such as filtering empty values. Composer orchestrates workflows but doesn't transform data itself. Pub/Sub is messaging. Bigtable is a database.
