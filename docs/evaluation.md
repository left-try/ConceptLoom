# Evaluation

ConceptLoom's evaluation tooling separates deterministic contract checks, recorded-output regression, and optional model judging. Evaluation reports do not update learner mastery. Structural checks can verify a source UID, locator, and content hash; they do not prove semantic entailment or long-term learning.

## Offline checks

Run the deterministic recorded-output comparison from the repository root:

```sh
npm run eval:structural
npm run eval:offline
npm run eval:report
```

The structural suite executes all 24 stable contract cases, including fixtures whose expected result is a rejection. The report writes JSON and Markdown under `.concept-loom/evaluation/`. It reads the optional model report only when its teaching-dataset digest matches the current dataset; calibration and holdout completeness stay separate. The release gate also requires human rubric labels to be reviewed, so model scores alone cannot claim calibration or release readiness.

With Node 22.22 or newer, run the locked Promptfoo comparison:

```sh
npm --prefix evals ci
npm --prefix evals run eval:recorded
```

Both candidates use fixed local outputs. No model provider or judge is called. Promptfoo is installed only under `evals/`; the MCP core remains on its existing Node 20 floor.

## Pedagogical dataset and labels

`evals/datasets/teaching.jsonl` contains 24 synthetic RU/EN cases across beginner/experienced levels and six situations. Every source excerpt is synthetic and hash-addressed. `evals/datasets/splits.json` separates 12 calibration cases from 12 holdout cases. Initial labels are `pending-review`; they do not establish human calibration agreement. A reviewed label must cite an excerpt from its exact source UID and locator.

The rubric scores mechanism, example, level, grounding, limitations, and practice from 0 to 3. The first four dimensions must each be at least 2. False attribution, solution leakage, or private-rubric leakage always fails. A strong average cannot offset a weak required dimension or critical failure.

## Optional model judge

No provider or judge is selected by default. Model evaluation requires an explicit provider, a known positive per-case cost estimate, a positive budget and case limit, plus `--allow-paid`:

```sh
npm run eval:model -- --provider openai:chat:<model> --cost-per-case-usd 0.01 --budget-usd 0.12 --max-cases 12 --allow-paid
```

Replace the provider and estimate with values appropriate to the configured account. Unknown price, missing credentials, budget overflow, and judge errors do not produce a pass. The runner calls cases sequentially, keeps calibration and holdout results separate, and writes reports to `.concept-loom/evaluation/`. Use only after reviewing the dataset and judge provider.

Review pending labels manually before claiming calibration. Holdout cases stay separate from judge tuning. Synthetic benchmark scores are regression evidence, not evidence of learner transfer or retention.
