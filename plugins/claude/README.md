# OMOPHub

Use OMOPHub in Claude to look up OMOP concepts, map vocabulary codes, explore concept hierarchies and resolve individual FHIR codings. The connector reads terminology from the vocabularies available to your OMOPHub account. Successful API reads count toward your account’s tier quota.

## Connect

Add the OMOPHub plugin in Claude, connect the OMOPHub connector and sign in to your OMOPHub account. Approve vocabulary access when prompted. To revoke access, open **Settings → Connected Apps** in the OMOPHub dashboard and disconnect Claude. [OMOPHub dashboard](https://dashboard.omophub.com)

## Try a lookup

- “Look up ICD10CM code E11.9. Give me the source OMOP concept ID and full name.”
- “Show the standard SNOMED mappings for ICD10CM E11.9.”
- “What vocabulary, domain and code does OMOP concept 201826 have?”

Send a terminology code or term on its own. Keep patient records and identifiers out of requests. OMOPHub provides read-only terminology lookup. For clinical treatment decisions, consult a qualified clinician.

## Claude Code

The bundle includes a terminology skill and Node.js hooks for supported Claude Code workflows. The hooks check tool inputs and replies, and use private files in the local Claude configuration directory to track results during a conversation turn.

[Documentation](https://docs.omophub.com) · [Support](https://omophub.com/contact) · [Privacy](https://omophub.com/privacy-policy) · [Terms](https://omophub.com/terms)
