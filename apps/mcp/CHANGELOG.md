# Changelog

## [0.6.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v0.5.0...artist-mcp-v0.6.0) (2026-08-13)


### Features

* **graph:** decline to walk a scan too large to read, and read windows ([a909280](https://github.com/ManudotaORG/artist-mcp/commit/a909280d0ebd4beb730678f42118087c0dcd29aa)), closes [#19](https://github.com/ManudotaORG/artist-mcp/issues/19)
* **graph:** list email attachments without reading them ([db708ee](https://github.com/ManudotaORG/artist-mcp/commit/db708eecdbf6496c0f54e4cb07394943fe36cdda)), closes [#19](https://github.com/ManudotaORG/artist-mcp/issues/19)
* **graph:** read a long document or a scan in page ranges ([b95d4f9](https://github.com/ManudotaORG/artist-mcp/commit/b95d4f9fc4a677efe8309d7e32e8b2ddf142e749)), closes [#19](https://github.com/ManudotaORG/artist-mcp/issues/19)
* **graph:** read email attachments as supporting evidence ([ca65952](https://github.com/ManudotaORG/artist-mcp/commit/ca659522887892f3c3b9bfd9ca8e1080e98e204b))
* **graph:** read Google Calendar as supporting evidence ([7aa0795](https://github.com/ManudotaORG/artist-mcp/commit/7aa0795a72aa11f27c9e64b5ea1465a9ab05ad51))
* **graph:** read long attachments and scans in page ranges ([0e37f96](https://github.com/ManudotaORG/artist-mcp/commit/0e37f96be6b4e9d351f858e5159980425d89270e))
* **graph:** read PDF attachments, naming the pages it cannot read ([7e8080d](https://github.com/ManudotaORG/artist-mcp/commit/7e8080d741e2c4f62631535e96fe56834217bcd3)), closes [#19](https://github.com/ManudotaORG/artist-mcp/issues/19)
* **graph:** return the diagrams a rider's text cannot describe ([b59a8f2](https://github.com/ManudotaORG/artist-mcp/commit/b59a8f2d851f5b2d4098342355eebd0881e8c48c)), closes [#19](https://github.com/ManudotaORG/artist-mcp/issues/19)
* **mcp:** expose list_emails and read_email ([fd2195f](https://github.com/ManudotaORG/artist-mcp/commit/fd2195fb3d861ad6bc3e09033d4bcb349b541272))


### Bug Fixes

* **graph:** key attachments on MIME position, not Gmail's id ([2b330fe](https://github.com/ManudotaORG/artist-mcp/commit/2b330feea297cc4ba9e4854d68b00cf3042f6efe)), closes [#19](https://github.com/ManudotaORG/artist-mcp/issues/19)
* **graph:** stop one recurring series filling the event page ([d8a3321](https://github.com/ManudotaORG/artist-mcp/commit/d8a3321ad4d19e253df10238152f4e885e463f07))
* say which connection failure this is, and stop overwriting the answer ([79f5e9c](https://github.com/ManudotaORG/artist-mcp/commit/79f5e9c3fbc82e7ebd8d4404c061563062cc25f7))
* say which connection failure this is, and stop overwriting the answer ([ade9ff3](https://github.com/ManudotaORG/artist-mcp/commit/ade9ff3f1e41a125ce24939fba6f7f5dfbdaac1e)), closes [#19](https://github.com/ManudotaORG/artist-mcp/issues/19)

## [0.5.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v0.4.0...artist-mcp-v0.5.0) (2026-08-12)


### Features

* **agent-pack:** define the intake phase ([7353672](https://github.com/ManudotaORG/artist-mcp/commit/7353672012d670b0ffa31977faebdeefa0a97df2))
* **agent-pack:** hand templates over as one file each ([9dc7999](https://github.com/ManudotaORG/artist-mcp/commit/9dc799939af1cd7e203344e125b6638fe79320a5))
* **mcp:** make list_notes ask which notebook instead of dumping all ([bbb5ebb](https://github.com/ManudotaORG/artist-mcp/commit/bbb5ebb0be78e40291aa464ffb35429955b4e7ae))
* **mcp:** put the intake policy in force without loading it ([d5c8aa7](https://github.com/ManudotaORG/artist-mcp/commit/d5c8aa767731d60e951cd6a602bba5c99df1f152))
* **mcp:** return project-type playbooks in full when listing ([3ecd01a](https://github.com/ManudotaORG/artist-mcp/commit/3ecd01a38b811a0df364aff3c66882d583b6aab0))
* **mcp:** surface the notebook each page belongs to ([9442c86](https://github.com/ManudotaORG/artist-mcp/commit/9442c86dd386f83e4fdfd011015e6ce585cd6d3e))


### Bug Fixes

* **agent-pack:** an unresolved dependency is still a dependency ([36d8c05](https://github.com/ManudotaORG/artist-mcp/commit/36d8c05cace06fdd8c8fe17338e2582ebabc031c))
* **agent-pack:** build templates for the clipboard ([3a59d2e](https://github.com/ManudotaORG/artist-mcp/commit/3a59d2e46596ca83747d01fcbabb9a681b5b8dd0))
* **agent-pack:** refuse to classify a rehearsal on shape alone ([50e70c8](https://github.com/ManudotaORG/artist-mcp/commit/50e70c844a9fa580f5437e886e862696a304a4d8))
* **agent-pack:** templates must paste, so present them formatted ([d347187](https://github.com/ManudotaORG/artist-mcp/commit/d34718715d03fc3c2a55fa97ca895d236c0f69e1))
* isolate runtime environments ([0a9c66e](https://github.com/ManudotaORG/artist-mcp/commit/0a9c66ef69a0eef751787d2abe647d78a6c2d9a3))
* isolate runtime environments ([9219785](https://github.com/ManudotaORG/artist-mcp/commit/921978598f701a0f0616b6d8d9cf8e27967af5e4))

## [0.4.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v0.3.0...artist-mcp-v0.4.0) (2026-08-11)


### Features

* add Microsoft disconnect flow ([a1fe598](https://github.com/ManudotaORG/artist-mcp/commit/a1fe598f2bbc3a631573394346bcacc1e0e0f205))

## [0.3.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v0.2.0...artist-mcp-v0.3.0) (2026-08-11)


### Features

* add environment-specific install paths ([fe25b2b](https://github.com/ManudotaORG/artist-mcp/commit/fe25b2bbdadce8f2b6ac01e91f08a0c5062bf9d7))

## [0.2.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v0.1.0...artist-mcp-v0.2.0) (2026-08-11)


### Features

* document the one-item agent workflow ([4d21a47](https://github.com/ManudotaORG/artist-mcp/commit/4d21a474a04a16a137d2b755431394ab180d2e19))
* integrate artist workflows and deployment setup ([6e815d4](https://github.com/ManudotaORG/artist-mcp/commit/6e815d49ff380ad7837011562f0bb13da48aa327))


### Bug Fixes

* declare npm package repository ([315b229](https://github.com/ManudotaORG/artist-mcp/commit/315b2291e0f65c149305b94f8cf84fb4deb88ca4))
