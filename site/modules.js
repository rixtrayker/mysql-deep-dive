// Module metadata: dir, code, title, track. Order = curriculum order.
export const TRACKS = {
  A: { name: 'Foundations & Modeling', accent: '#58a6ff' },
  B: { name: 'Performance Core', accent: '#7ee2a8' },
  C: { name: 'Concurrency & Internals', accent: '#d2a8ff' },
  D: { name: 'Scale & Distribution', accent: '#f0c674' },
  E: { name: 'Operations & Production', accent: '#ff9e64' },
  F: { name: 'Fintech Capstone', accent: '#ff7b9c' },
};

export const MODULES = [
  { code: 'M01', dir: 'M01-relational-foundations-and-data-modeling', title: 'Relational Foundations & Data Modeling', track: 'A' },
  { code: 'M02', dir: 'M02-normalization-and-denormalization', title: 'Normalization & Denormalization', track: 'A' },
  { code: 'M03', dir: 'M03-data-types-and-schema-design', title: 'MySQL Data Types & Schema Design', track: 'A' },
  { code: 'M04', dir: 'M04-how-mysql-executes-a-query', title: 'How MySQL Executes a Query', track: 'B' },
  { code: 'M05', dir: 'M05-indexing-deep-dive', title: 'Indexing Deep Dive', track: 'B', star: true },
  { code: 'M06', dir: 'M06-query-optimization-and-execution-plans', title: 'Query Optimization & Execution Plans', track: 'B' },
  { code: 'M07', dir: 'M07-transactions-and-acid', title: 'Transactions & ACID', track: 'C' },
  { code: 'M08', dir: 'M08-locking-and-mvcc', title: 'Locking & MVCC', track: 'C', star: true },
  { code: 'M09', dir: 'M09-innodb-internals-and-disk-durability', title: 'InnoDB Internals & Disk Durability', track: 'C', star: true },
  { code: 'M10', dir: 'M10-replication', title: 'Replication', track: 'D', star: true },
  { code: 'M11', dir: 'M11-sharding', title: 'Partitioning, Sharding & Scaling Out', track: 'D', star: true },
  { code: 'M12', dir: 'M12-distributed', title: 'Distributed Data Concerns', track: 'D', star: true },
  { code: 'M13', dir: 'M13-operations', title: 'Operations, Backups & Observability', track: 'E', star: true },
  { code: 'M14', dir: 'M14-cheatsheet', title: 'Production Cheat-Sheet & Decision Guides', track: 'E', star: true },
  { code: 'M15', dir: 'M15-failure-modes', title: 'Failure Modes, Data Loss & Recovery', track: 'E', star: true },
  { code: 'M16', dir: 'M16-fintech-capstone', title: 'Fintech System Design with MySQL', track: 'F', star: true },
];
