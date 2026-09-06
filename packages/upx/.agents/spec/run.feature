@frozen
Feature: upx — the local-first package runner

  # Observability harness: fixtures are spec-owned, not real registry packages.
  # Each fixture bin prints a unique marker so a test can see WHICH path ran; a shim
  # "npx" on PATH prints its own marker, so an assertion that stdout carries the fixture
  # marker (and not the npx marker) proves a direct local/global spawn, and vice versa.
  # Fixture versions are chosen so the ranges below satisfy under node-semver
  # (caret on a 0.0.x version pins the patch, so fixtures use 1.x).

  Background:
    Given a shim "npx" on PATH that prints "NPX-SHIM <args>" and exits 0
    And a local install "tool-a" at version "1.2.3" whose bin "tool-a" prints "TOOL-A-LOCAL <args>"

  # ── Local-first resolution ──

  Scenario: a satisfying local install runs, and npx is not used
    When I run "upx tool-a@^1.0.0 build"
    Then stdout contains "TOOL-A-LOCAL build"
    And stdout does not contain "NPX-SHIM"
    And the exit code is 0

  Scenario: a local install is preferred over a global one when both satisfy
    Given a global install "tool-a" at version "1.9.0" whose bin prints "TOOL-A-GLOBAL"
    When I run "upx tool-a@^1.0.0"
    Then stdout contains "TOOL-A-LOCAL"
    And stdout does not contain "TOOL-A-GLOBAL"

  Scenario: the nearest of two ancestor local installs wins
    # the Background install (cwd node_modules, tool-a@1.2.3 → TOOL-A-LOCAL) is the nearer one
    Given a farther ancestor "node_modules" install "tool-a" at version "1.5.0" whose bin prints "TOOL-A-ANCESTOR"
    When I run "upx tool-a@^1.0.0"
    Then stdout contains "TOOL-A-LOCAL"
    And stdout does not contain "TOOL-A-ANCESTOR"

  # ── Global install ──

  Scenario: a satisfying global install runs when there is no local install
    Given no local install "tool-b"
    And a global install "tool-b" at version "1.4.0" whose bin prints "TOOL-B-GLOBAL <args>"
    When I run "upx tool-b@^1.0.0 unit list"
    Then stdout contains "TOOL-B-GLOBAL unit list"
    And stdout does not contain "NPX-SHIM"

  # ── Range semantics ──

  Scenario Outline: a semver range the installed version satisfies runs locally
    When I run "upx tool-a@<range>"
    Then stdout contains "TOOL-A-LOCAL"
    And stdout does not contain "NPX-SHIM"

    Examples:
      | range   |
      | ^1.0.0  |
      | ~1.2.0  |
      | 1.2.3   |

  Scenario: a bare package with no range matches any installed version
    When I run "upx tool-a"
    Then stdout contains "TOOL-A-LOCAL"
    And stdout does not contain "NPX-SHIM"

  Scenario: a trailing @ with an empty range is treated as bare and matches any installed version
    When I run "upx tool-a@"
    Then stdout contains "TOOL-A-LOCAL"
    And stdout does not contain "NPX-SHIM"

  Scenario: a dist-tag spec goes to npx, and the miss notice names it a dist-tag, not a range being satisfied
    When I run "upx tool-a@next"
    Then stdout contains "NPX-SHIM tool-a@next"
    And stderr contains "upx: no installed tool-a"
    And stderr contains "dist-tag"
    And stderr does not contain "satisfies"

  # ── npx fallback ──

  Scenario: no installed version satisfying the range falls back to npx with a notice
    When I run "upx tool-a@^9.0.0"
    Then stdout contains "NPX-SHIM tool-a@^9.0.0"
    And stderr contains "upx: no installed tool-a satisfies"
    And stderr contains "using npx"

  Scenario: a package installed nowhere falls back to npx with the spec exactly as given
    Given no local install "cowsay"
    And no global install "cowsay"
    When I run "upx cowsay@^1.0.0 hello"
    Then stdout contains "NPX-SHIM cowsay@^1.0.0 hello"

  Scenario: a bare-package miss falls back to npx with the bare spec (no @*)
    Given no local install "cowsay"
    And no global install "cowsay"
    When I run "upx cowsay"
    Then stdout contains "NPX-SHIM cowsay"
    And stdout does not contain "cowsay@"

  Scenario: the fallback passes through a non-zero npx exit code
    Given the shim "npx" exits with code 7 for the given arguments
    When I run "upx tool-a@^9.0.0 build"
    Then stdout contains "NPX-SHIM tool-a@^9.0.0 build"
    And the exit code is 7

  Scenario: a fallback writes nothing into node_modules or the global store
    Given the project's "node_modules" and the "npm root -g" store contents are recorded
    When I run "upx cowsay@^1.0.0"
    Then the project's "node_modules" is unchanged
    And the "npm root -g" store is unchanged

  # ── Transparent passthrough ──

  Scenario: arguments after the package spec are forwarded to the child verbatim
    When I run "upx tool-a@^1.0.0 diff --format json a.feature b.feature"
    Then stdout contains "TOOL-A-LOCAL diff --format json a.feature b.feature"

  Scenario: a bare -- and the arguments after it are forwarded verbatim
    When I run "upx tool-a@^1.0.0 -- --raw x"
    Then stdout contains "TOOL-A-LOCAL -- --raw x"

  Scenario: the child's non-zero exit code becomes upx's exit code
    Given the local "tool-a" bin exits with code 3 for the given arguments
    When I run "upx tool-a@^1.0.0 validate broken.feature"
    Then the exit code is 3

  # ── Bin resolution ──

  Scenario: a package whose executable name differs from the package name resolves its bin
    Given a local install "some-tool" at version "2.0.0" whose only bin is named "st" and prints "ST-BIN"
    When I run "upx some-tool@^2.0.0"
    Then stdout contains "ST-BIN"

  Scenario: a package with multiple bins where one matches the package name resolves that bin
    Given a local install "multi2" at version "1.0.0" declaring bins "x" and "multi2" where "multi2" prints "MULTI2-BIN"
    When I run "upx multi2@^1.0.0"
    Then stdout contains "MULTI2-BIN"

  Scenario: a package declaring multiple bins none matching its name fails loud
    Given a local install "multi" at version "1.0.0" declaring bins "x" and "y"
    When I run "upx multi@^1.0.0"
    Then the exit code is 1
    And stderr contains "error:"
    And stderr contains "multi"

  Scenario: a package that declares no bin fails loud
    Given a local install "nobin" at version "1.0.0" declaring no bin
    When I run "upx nobin@^1.0.0"
    Then the exit code is 1
    And stderr contains "error:"
    And stderr contains "nobin"

  # ── Scoped packages ──

  Scenario: a scoped package resolves on the last @ and runs locally
    Given a local install "@acme/cli" at version "1.2.0" whose bin prints "ACME-CLI <args>"
    When I run "upx @acme/cli@^1.0.0 build"
    Then stdout contains "ACME-CLI build"
    And stdout does not contain "NPX-SHIM"

  # ── Argument boundary ──

  Scenario: a flag after the package spec goes to the child, not to upx
    When I run "upx tool-a@^1.0.0 --help"
    Then stdout contains "TOOL-A-LOCAL --help"
    And stdout does not contain "Usage: upx"

  Scenario: an unknown flag before the package spec fails loud
    When I run "upx --bogus tool-a@^1.0.0"
    Then the exit code is 1
    And stderr contains "--bogus"

  # ── Fail-loud ──

  Scenario: no package spec fails loud
    When I run "upx"
    Then the exit code is 1
    And stderr contains "error:"
    And stderr contains "package"

  Scenario: an unparseable package spec fails loud
    When I run "upx @@@bad@@@"
    Then the exit code is 1
    And stderr contains "error:"

  # ── Help ──

  Scenario: --help documents the runner
    When I run "upx --help"
    Then the exit code is 0
    And stdout contains "Usage: upx"
    And stdout contains "<pkg>@<range>"
    And stdout contains "npx"
