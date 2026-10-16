# Helios greeter

A one-script greeter — the repository the e2e suite's **live slice** edits
([#1314](https://github.com/NobuData/ouroboros/issues/1314), DI.5). It is deliberately the
smallest project that has a bug, a test that catches it, and nothing else:

    $ bin/greet World
    Hello, World!

    $ bin/greet
    Hello, world!

Run the test with `sh tests/check.sh` (or `make check`); its exit status is the verdict.
Nothing here needs a toolchain beyond `sh`, so the suite's bare build runner can run it.
