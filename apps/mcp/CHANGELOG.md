# Changelog

## [1.4.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v1.3.0...artist-mcp-v1.4.0) (2026-08-24)


### Features

* a hosted MCP over HTTPS, for clients that cannot spawn a process ([01b2fbb](https://github.com/ManudotaORG/artist-mcp/commit/01b2fbb91bb9385455e273dd9e5235eb903ec1c2)), closes [#55](https://github.com/ManudotaORG/artist-mcp/issues/55)
* a hosted MCP server, OAuth 2.1, and server-side token custody ([#55](https://github.com/ManudotaORG/artist-mcp/issues/55)) ([c1ad7eb](https://github.com/ManudotaORG/artist-mcp/commit/c1ad7ebdd0afaaa0750c351aa0a04286a819e5c9))
* **web:** resolve a user's provider token from server-side custody ([9381dfe](https://github.com/ManudotaORG/artist-mcp/commit/9381dfed253e490258aa2544a0e908ccb98f67a9)), closes [#55](https://github.com/ManudotaORG/artist-mcp/issues/55)


### Bug Fixes

* **mcp:** say which throttle it is, and how long it actually asked for ([a76d221](https://github.com/ManudotaORG/artist-mcp/commit/a76d221e5ff9a724df62fa0de35c46c08720d175)), closes [#91](https://github.com/ManudotaORG/artist-mcp/issues/91)
* **mcp:** wait as long as the provider asks, and no longer than is useful ([1b27af5](https://github.com/ManudotaORG/artist-mcp/commit/1b27af5fd3c31c28eefb80b55f5795a472eb3f87)), closes [#55](https://github.com/ManudotaORG/artist-mcp/issues/55)

## [1.3.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v1.2.0...artist-mcp-v1.3.0) (2026-08-16)


### Features

* **agent-pack:** hand the musician a paste-ready page patch ([ecd95ef](https://github.com/ManudotaORG/artist-mcp/commit/ecd95efaaaeb9f6bfd407ff8b5d83faf12d5371d))


### Bug Fixes

* **agent-pack:** let "not sure" settle a field, so the page is reachable ([ea2b803](https://github.com/ManudotaORG/artist-mcp/commit/ea2b803d4b8cccacb1f38188a847e8a1a201028d))
* **agent-pack:** stop AGENTS.md restating rules it cannot keep current ([b0364c7](https://github.com/ManudotaORG/artist-mcp/commit/b0364c725c1b22fd2548a5bf8d42ae48df27011f))
* **mcp:** announce the playbooks in the handshake, so they are in force ([46acdab](https://github.com/ManudotaORG/artist-mcp/commit/46acdab0d6e51e3e9ff212988dc7790be6aab064))

## [1.2.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v1.1.0...artist-mcp-v1.2.0) (2026-08-16)


### Features

* **agent-pack:** answer anyway, and say what the skipped work cost ([d88aec1](https://github.com/ManudotaORG/artist-mcp/commit/d88aec139e02835a7ab907487f1b8064a9af8a79))
* **agent-pack:** answer the question, and keep the machinery out of it ([f09b57d](https://github.com/ManudotaORG/artist-mcp/commit/f09b57da0667a22bb6129c0aeb7e854f4abca926))
* **agent-pack:** ask when the answer changes the work, otherwise decide ([2c7def2](https://github.com/ManudotaORG/artist-mcp/commit/2c7def2628b3b2d5961865628e0d7b3a7b1e3227))
* **agent-pack:** reuse the artist's template, and stop guessing at empty pages ([59d894a](https://github.com/ManudotaORG/artist-mcp/commit/59d894a73cc108ac383aeab4fd3048aa6fe850ec))
* **agent-pack:** stamp every generated template with its version ([bed4b1d](https://github.com/ManudotaORG/artist-mcp/commit/bed4b1d154bf2fadbfdd838d8efd7400b3bba228))
* **agent-pack:** stop one event drifting across two pages ([3383f80](https://github.com/ManudotaORG/artist-mcp/commit/3383f8022cd2edf3331a62888e935d327086801c)), closes [#65](https://github.com/ManudotaORG/artist-mcp/issues/65)
* **agent-pack:** tell a copied page from a duplicated one ([7bb4169](https://github.com/ManudotaORG/artist-mcp/commit/7bb41698b829a156143946e6ff7e260dc26936b5))
* **mcp:** cap and continue long note reads, as attachments already do ([296a3b2](https://github.com/ManudotaORG/artist-mcp/commit/296a3b28b885b60bf0b9f9d4f662c36c79c464cd)), closes [#67](https://github.com/ManudotaORG/artist-mcp/issues/67)
* **mcp:** let list_notes narrow by modified date and count ([216a7e7](https://github.com/ManudotaORG/artist-mcp/commit/216a7e769c936433fd919c316aa4f1236b6e7c2b)), closes [#66](https://github.com/ManudotaORG/artist-mcp/issues/66)
* **mcp:** make status verify the install, not only the connections ([4d2b464](https://github.com/ManudotaORG/artist-mcp/commit/4d2b46454b038bf5d2eebc35567d190a6600c7e4)), closes [#61](https://github.com/ManudotaORG/artist-mcp/issues/61)
* **mcp:** map a notebook from page previews before reading it ([339664e](https://github.com/ManudotaORG/artist-mcp/commit/339664e65161ad2be60614c48dc87af2ca4f7a74)), closes [#65](https://github.com/ManudotaORG/artist-mcp/issues/65)


### Bug Fixes

* **agent-pack:** a due list is an answer, so it may not settle a conflict ([205588b](https://github.com/ManudotaORG/artist-mcp/commit/205588b27f53b38e3434b4507afb9de926c535b4))
* **agent-pack:** a fact worked out is not a fact read, and a heading is a claim ([fd699c2](https://github.com/ManudotaORG/artist-mcp/commit/fd699c25aa866afa90b135c44d8fb46fff0ebad1))
* **agent-pack:** answer first, then offer the file — and never list formats ([a28c310](https://github.com/ManudotaORG/artist-mcp/commit/a28c3108d63a72c7238d3a8cd19bc8f60873a4f6))
* **agent-pack:** decide duplicates on identity, not on resemblance ([a933381](https://github.com/ManudotaORG/artist-mcp/commit/a933381a282af00c9ef8a14ce7e6e5f0856f8798)), closes [#65](https://github.com/ManudotaORG/artist-mcp/issues/65)
* **agent-pack:** look for templates when asked about them, not only for them ([2f7effb](https://github.com/ManudotaORG/artist-mcp/commit/2f7effb196060f15c01a4825d376e015c1484b46))
* **agent-pack:** put the evidence boundary where a user's session can see it ([9492e3a](https://github.com/ManudotaORG/artist-mcp/commit/9492e3a780408bf2fa551bbfad2bdd9ec38d47fb))
* **agent-pack:** stop answering and intake contradicting each other on files ([6428f31](https://github.com/ManudotaORG/artist-mcp/commit/6428f31799efe97975c1dba2f533af915682443e))
* **agent-pack:** stop the Janitor claiming cross-page work it cannot do ([1907045](https://github.com/ManudotaORG/artist-mcp/commit/19070457006c74ef399d1a681522b3e95ed9bfec)), closes [#72](https://github.com/ManudotaORG/artist-mcp/issues/72)
* **agent-pack:** templates keep the playbooks' set and the artist's shape ([8a4b6d7](https://github.com/ManudotaORG/artist-mcp/commit/8a4b6d7ce8eeac66a2aa655ab15b57330aa2064c))
* **mcp:** a guessed notebook is not a chosen one ([c7a57f7](https://github.com/ManudotaORG/artist-mcp/commit/c7a57f7f61155774c596783cea98912edc43493f))
* **mcp:** ask which notebook, rather than answering and disclaiming ([f4224ba](https://github.com/ManudotaORG/artist-mcp/commit/f4224ba69be3993c814badedb573db4f549d84bc))
* **mcp:** stop the Google tools inviting the search their policy forbids ([5b1b396](https://github.com/ManudotaORG/artist-mcp/commit/5b1b39618b7e1f74d7558ed01f3fc0ea5e2120fd))

## [1.1.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v1.0.1...artist-mcp-v1.1.0) (2026-08-14)


### Features

* **mcp:** install with a playbook directory of your own ([f30c93f](https://github.com/ManudotaORG/artist-mcp/commit/f30c93f306f5968388a513c1ff59ba557b630345))
* **mcp:** let a local pack use a visible artist/ directory ([cba4952](https://github.com/ManudotaORG/artist-mcp/commit/cba49521806b1236041d7a929f809164bfd85410))
* **mcp:** make editable playbooks one all-in install, not per file ([d8a6e43](https://github.com/ManudotaORG/artist-mcp/commit/d8a6e43571744a730fbb7b479f8190165674c248))
* **mcp:** name the file behind a playbook the user owns ([d3ef785](https://github.com/ManudotaORG/artist-mcp/commit/d3ef78561fbcdb64fc00efe6c8f2140cb9aa727a))
* **mcp:** read playbooks from a directory the user owns ([76589b1](https://github.com/ManudotaORG/artist-mcp/commit/76589b13b5dc34ce014265d66229dce9d6128acf))
* **mcp:** report which workflow files are in force ([13e198d](https://github.com/ManudotaORG/artist-mcp/commit/13e198d5d851a5073aefc5df022acb6871345064))


### Bug Fixes

* **mcp:** give a staging build its version in both places that carry one ([fac62f7](https://github.com/ManudotaORG/artist-mcp/commit/fac62f744fd1377393f0cf8d34fa4c232f685494))
* **mcp:** keep workflow packs out of the home directory ([b7396fd](https://github.com/ManudotaORG/artist-mcp/commit/b7396fd6a116dfe593e5d96820547f35980f8e04))
* **mcp:** refuse a playbook filed outside the three known directories ([618374b](https://github.com/ManudotaORG/artist-mcp/commit/618374bddcfafe64b9899d66db1c9de9666fcb50))
* **mcp:** report a playbook that cannot be read instead of summarising it ([428cfe0](https://github.com/ManudotaORG/artist-mcp/commit/428cfe015e6b1d38bc3aece977f6ece439444b8e))
* **mcp:** say "1 playbook" rather than "1 playbooks" ([ee8d333](https://github.com/ManudotaORG/artist-mcp/commit/ee8d3337945be42f090a9774bbf212f5721fc452))

## [1.0.1](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v1.0.0...artist-mcp-v1.0.1) (2026-08-14)


### Bug Fixes

* **mcp:** cache the Google client secret after fetching it ([94a9a5a](https://github.com/ManudotaORG/artist-mcp/commit/94a9a5a4f4c6dc953140c0a1fc75549df107673e))

## [1.0.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v0.8.0...artist-mcp-v1.0.0) (2026-08-14)


### ⚠ BREAKING CHANGES

* **mcp:** run operations on this machine instead of the edge function

### Features

* **mcp:** add connect, disconnect and status commands ([2ad73a3](https://github.com/ManudotaORG/artist-mcp/commit/2ad73a3cc4e8399d1d6a34f15edf77230c0b8455))
* **mcp:** port attachment reading into the package ([8f58fea](https://github.com/ManudotaORG/artist-mcp/commit/8f58feaaf70eb0a0a33f888668071c5bac9ffc78))
* **mcp:** port the Calendar operations into the package ([dee208b](https://github.com/ManudotaORG/artist-mcp/commit/dee208b91d7b032c049bd30aab90444491729fab))
* **mcp:** port the Gmail list and read operations ([29b7d99](https://github.com/ManudotaORG/artist-mcp/commit/29b7d990a70fbdf3dd93b8749ca4e0d6c7678fca))
* **mcp:** port the OneNote operations into the package ([d592822](https://github.com/ManudotaORG/artist-mcp/commit/d592822a0d76c868b341bef8fdc5b419d986eea1))
* **mcp:** run operations on this machine instead of the edge function ([29fda74](https://github.com/ManudotaORG/artist-mcp/commit/29fda74ebb4b78d690a3ff27a48b0f8fc185261c))
* **mcp:** sign in to providers from this machine ([9ebc80d](https://github.com/ManudotaORG/artist-mcp/commit/9ebc80dcc3f8b58fdd109e4fd025565ae84fd948))
* **mcp:** store provider tokens on this machine ([2bca81e](https://github.com/ManudotaORG/artist-mcp/commit/2bca81eeb890cf726178c0708e19e044dc82a24d))
* serve Google's client secret instead of publishing it ([f9d8fb5](https://github.com/ManudotaORG/artist-mcp/commit/f9d8fb5a77b8a4583054e0bc0612566b558aaacb))

## [0.8.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v0.7.0...artist-mcp-v0.8.0) (2026-08-13)


### Features

* **mcp:** allow opt-in Gmail and Calendar evidence in the agent pack ([0dcb902](https://github.com/ManudotaORG/artist-mcp/commit/0dcb9028325523add7c7e8cf08b07ab255404c46))


### Bug Fixes

* **mcp:** register the dist-tag init was run from ([2f0a6fd](https://github.com/ManudotaORG/artist-mcp/commit/2f0a6fdd053fd03a61034250455f5a82e059044c))
* **mcp:** register the dist-tag init was run from ([13e0e2c](https://github.com/ManudotaORG/artist-mcp/commit/13e0e2c1c9fd67f2add96839e50ab00816cd4ea6))

## [0.7.0](https://github.com/ManudotaORG/artist-mcp/compare/artist-mcp-v0.6.0...artist-mcp-v0.7.0) (2026-08-13)


### Features

* **graph:** map a PDF so pages can be chosen instead of walked ([46d2ee9](https://github.com/ManudotaORG/artist-mcp/commit/46d2ee991147e766e6ba009f8e981efe604f59b6))
* **graph:** map a PDF so pages can be chosen instead of walked ([274a7ed](https://github.com/ManudotaORG/artist-mcp/commit/274a7ed90ce067482b6bd8dc212db9e14d999426)), closes [#26](https://github.com/ManudotaORG/artist-mcp/issues/26)
* **graph:** read image and Word attachments, and decline formats by name ([91089bf](https://github.com/ManudotaORG/artist-mcp/commit/91089bf2d213a7dbf2a1cf12946bf2255cb267ed))
* **graph:** read Word .docx attachments ([333d8b1](https://github.com/ManudotaORG/artist-mcp/commit/333d8b171adbec8b344861c1eecd315f611de54b)), closes [#34](https://github.com/ManudotaORG/artist-mcp/issues/34)
* **graph:** show image attachments, and decline formats by name ([b035f63](https://github.com/ManudotaORG/artist-mcp/commit/b035f639f27d48c47eedae00337380d180ab88ad)), closes [#34](https://github.com/ManudotaORG/artist-mcp/issues/34)

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
