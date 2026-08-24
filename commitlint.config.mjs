/**
 * Conventional commits, with Dependabot exempted.
 *
 * Every Dependabot pull request failed `body-max-line-length`: it emits release
 * notes and long dependency URLs, and the rule exists so that a *person* writes
 * a body that reads well in a terminal. The check was rejecting the messenger
 * rather than catching anything, and it blocked dependency updates that were
 * otherwise fine.
 *
 * This exempts the whole message for those commits, not just that one rule.
 * Narrowing it to a single rule would mean writing a commitlint plugin, because
 * a function under `rules` is a config factory rather than a rule
 * implementation — more machinery than the problem deserves. The exemption is
 * safe here because Dependabot already writes conventional subjects
 * (`build(deps): …`), so Release Please still classifies its commits correctly;
 * what is skipped is enforcement of a format it already follows.
 *
 * The predicate matches Dependabot specifically. A person writing
 * `build(deps): bump …` by hand is still checked, because they will not carry
 * its sign-off trailer.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => /^Signed-off-by: dependabot\[bot\]/m.test(message)],
};
