---
exam_maker: sample
exam_name: cloud-data
exam_number: 1
title: Sample Cloud Data – Warehousing Basics
duration_minutes: 10
domain_count: 3
made_by: Sample Model 1
flavour: Easy, but every question has one confusing answer
---

# Domains

- D1: Modelling
- D2: Querying
- D3: Operations

# Questions

## Q1
An analytics team stores every sale as one row with a product ID, a store ID and a date, and keeps product and store details in separate tables. What is this design called?

- A) A star schema
- B) A key-value store
- C) A document model
- D) A graph model

## Q2
A table of daily sales has a `region` column with only five possible values. Analysts filter by region in almost every query. Which change helps those queries most?

- A) Add a free-text description column
- B) Cluster the table by `region`
- C) Store the table as CSV files
- D) Split each row into five rows

## Q3
This query counts orders per day:

```sql
SELECT order_date, COUNT(*) AS orders
FROM shop.orders
GROUP BY order_date;
```

What happens to days with no orders at all?

- A) They appear with a count of 0
- B) They don't appear in the result
- C) The query fails
- D) They appear with a count of NULL

## Q4
Two analysts get different totals from the same dashboard because one includes cancelled orders. What is the most durable fix?

- A) Ask both analysts to double-check their filters
- B) Define the metric once in a shared view and point the dashboard at it
- C) Export the data to a spreadsheet each morning
- D) Remove the cancelled orders from the source system

## Q5
A nightly load job sometimes runs twice, and the table ends up with duplicate rows. What makes the load safe to repeat?

- A) Running the job only on weekdays
- B) Making the load idempotent, e.g. a MERGE on a unique key
- C) Adding more memory to the job
- D) Loading into a new table name every night

## Q6
Old raw files are needed only for audits and are almost never read. How should they be stored?

- A) In the fastest storage tier, for quick audits
- B) In a low-cost archival tier with a retention rule
- C) Deleted after a week
- D) Copied into the warehouse as extra tables

# Answers

## Q1
Answer: A
Domain: D1
Explanation: A central fact table with foreign keys to dimension tables is a star schema. Key-value, document and graph models organise data differently.

## Q2
Answer: B
Domain: D2
Explanation: Clustering by `region` stores rows with the same region together, so filtered queries read less data. A adds data, C removes the warehouse's optimisations, and D just multiplies rows.

## Q3
Answer: B
Domain: D2
Explanation: GROUP BY only produces groups for values that exist, so days with no orders are missing. Joining against a calendar table would bring them back with 0.

## Q4
Answer: B
Domain: D1
Explanation: A single shared definition removes the disagreement at its source. A relies on people, C adds manual work, and D destroys data you may need.

## Q5
Answer: B
Domain: D3
Explanation: An idempotent MERGE on a unique key gives the same result however many times it runs. The other options don't prevent duplicates.

## Q6
Answer: B
Domain: D3
Explanation: Archival tiers cost the least for rarely read data, and a retention rule enforces the audit period. A wastes money, C breaks the audit requirement, and D bloats the warehouse.
