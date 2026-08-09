# corpus-exclusions.md — What never enters the voice corpus

Zaire edits this file directly. Anything matching a rule below is dropped at corpus
build time — never stored, never embedded, never retrieved as a style example
(spec §6.1). When in doubt, add the exclusion: the corpus loses one example; a leak
is forever.

Matching is case-insensitive. Contacts match against To/Cc addresses (a bare domain
or address fragment matches anything containing it). Keywords match against subject
and body.

## Excluded contacts

- legal@

## Excluded keywords

- term sheet
- redline
- promissory
- loan agreement
- wire instructions
- routing number
- investor update
- cap table
- offer letter
- salary
- severance
- medical
