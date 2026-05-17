# Authentication & User Accounts

The site must support secure global authentication using:

- Email + password login
- Email verification required before uploads or hearting (using Resend)
- Simple user profile pages
- Account deletion, including deletion of:
  - All uploads owned by the user
  - All generated history owned by the user

Anonymous usage is still allowed for generation features.

Unverified accounts must be treated identically to anonymous users for all public-facing permissions and restrictions.

---

# Generation System (McMinimap + Unit GIFs)

## Anonymous Users

Anonymous users can:

- Generate McMinimaps
- Generate Unit GIFs

Anonymous generations are permanently detached and cannot later be claimed by an account.

The upload/history UI should reinforce this clearly by displaying:

- `Uploader: Anonymous`

for content generated anonymously.

---

## Signed-In Users

When a signed-in user generates content:

- The generation is public by default
- The generation is saved into the user’s private history
- The user may choose to hide the generation from public feeds
- Visibility is configurable per generation

---

# Visibility Rules

Scenarios and campaigns support visibility settings.

By default:

- Uploaded scenarios are public
- Uploaded campaigns are public
- Campaign-owned scenario mirrors are public

Users may hide:

- Standalone scenarios
- Campaigns
- The scenario set belonging to a campaign

If a campaign is hidden:

- All mirrored campaign-owned scenarios must also disappear from public listings, search, and pages

Hidden content should:

- Remain accessible to the owner
- Be inaccessible from public feeds, search, and indexing

---

# Upload System

Uploads continue using Cloudflare checkout/upload infrastructure.

Only registered and email-verified users may upload:

- Scenarios
- Campaigns

---

# Filename Identity Rules

Scenarios are uniquely identified by their normalized stored filename.

Uploaded files are also checked using file hashes to prevent duplicate uploads.

To prevent cross-user filename collisions:

Uploaded files are internally renamed using the uploader username suffix.

## Example

Original upload:

- `Mission1.scx`

Uploaded by:

- `Hunter2`

Stored internally as:

- `Mission1 by Hunter2.scx`

The displayed title may still remain:

- `Mission1`

The internal filename identity must remain unique and stable.

Only one campaign may reference a specific scenario file.

---

# Collision Rules

The system must enforce strict collision handling.

## Standalone Scenario Priority

Standalone scenarios take priority over campaign-contained scenarios.

### Example

If a user uploads:

- `Mission1.scx`

Then later uploads:

- `Bari Campaign`

containing:

- `Mission1.scx`

The campaign upload must be rejected with a warning explaining the filename conflict.

---

## Reverse Collision Case

If a user uploads:

- `Bari Campaign`

containing:

- `Mission1.scx`

Then later uploads:

- `Mission1.scx`

The standalone scenario must be automatically renamed:

- `Mission1 [alt1].scx`

Additional collisions increment sequentially:

- `[alt2]`
- `[alt3]`
- etc.

---

# Scenario Types

## Standalone Scenarios

Standalone scenarios:

- Are editable independently
- Can be updated directly
- Support visibility settings
- Support hearts

---

## Campaign-Owned Scenarios

Campaign-owned scenarios:

- Are read-only mirrors derived from campaign uploads
- Cannot be edited independently
- Cannot be updated independently
- Must inherit campaign ownership
- Must inherit campaign visibility
- Must inherit campaign hearting behavior

A mirrored scenario can only be hearted through its parent campaign.

---

# Campaign System

Campaigns must have their own dedicated page and upload flow.

The Scenarios page must no longer allow campaign uploads.

Campaign pages must display:

- Campaign metadata
- Parsed minimap data
- Parsed metadata
- Scenario list
- Version information
- Hearts
- Linked mod (if applicable)

---

# Campaign Scenario Mirroring

When a campaign is uploaded:

- Its scenarios automatically appear in the Scenarios page
- Those scenarios must link back to the parent campaign
- Those scenarios are read-only mirrors

Only one campaign may own/reference a mirrored scenario file at a time.

---

# Versioning Rules

Version history only applies to uploaded files themselves.

Updates fully overwrite previous state.

The system only preserves the latest version state.

There is no immutable historical snapshot system.

---

# Campaign Update Behavior

## Example

Campaign `v1` contains:

- A
- B
- C

Campaign `v2` contains:

- A
- B
- D

## Result

- Scenario `C` is completely removed
- Scenario `C` pages no longer exist
- Scenario `C` disappears from all listings, search, and pages
- Scenario `D` appears instead

The latest upload fully replaces the previous campaign state.

Removed scenarios do not preserve:

- Redirects
- Historical pages
- Recoverable state

---

# Parsed Data

Parsed metadata and parsed minimaps:

- Are regenerated on every upload/update
- Are not editable by users
- Are not editable by admins

---

# Hearts System

Users may:

- Heart scenarios
- Heart campaigns
- Remove hearts

## Rules

- One heart per user per item
- Anonymous users cannot heart
- Unverified users cannot heart
- Hearts are tied to account IDs
- Hearts vanish immediately when content is deleted
- Campaigns and standalone scenarios use the same heart system

Campaign-owned mirrored scenarios:

- Cannot be hearted independently
- Must redirect heart interactions to the parent campaign

If content is deleted:

- All associated hearts are permanently deleted immediately

---

# Comments

Comments are disabled entirely for now.

No commenting system should be implemented.

---

# Update Behavior

Updates:

- Completely overwrite prior uploaded state
- Store date
- Store history of updates (version + date only)
- Do not preserve historical variants
- Do not preserve removed scenarios
- Do not preserve old parsed metadata

Links remain stable because:

- Names/titles cannot be changed after upload

Removed scenarios and campaigns:

- Lose all direct links permanently
- Do not preserve redirects
- Do not preserve archived pages

---

# Account Deletion Behavior

Account deletion permanently removes:

- Owned campaigns
- Owned standalone scenarios
- Campaign-owned mirrored scenarios
- Generated history
- Hearts owned by the user
- Associated parsed data

Deletion is permanent and non-recoverable.

---

# Authorization Matrix

| Action | Anonymous | Unverified | Verified | Owner | Admin |
|---|---|---|---|---|---|
| Generate GIF | Yes | Yes | Yes | Yes | Yes |
| Save history | No | No | Yes | Yes | Yes |
| Upload scenario | No | No | Yes | Yes | Yes |
| Upload campaign | No | No | Yes | Yes | Yes |
| Edit scenario | No | No | No | Yes | Yes |
| Edit campaign | No | No | No | Yes | Yes |
| Heart content | No | No | Yes | Yes | Yes |
| Delete account | No | Yes | Yes | Yes | Yes |
| Manage visibility | No | No | No | Yes | Yes |
| Moderate content | No | No | No | No | Yes |

---

# Important Implementation Constraints

- Scenario identity is filename-based using normalized stored filenames
- Duplicate uploads are additionally checked using file hashes
- Only one campaign may reference a specific scenario file
- Campaign-owned scenarios are not independent entities
- Campaign updates replace previous campaign state entirely
- No immutable history system exists
- No comments system exists
- Public visibility is default unless hidden manually
- Anonymous generations are permanently detached from accounts
- Deleted content is permanently removed without redirects or archival recovery
- The system should prioritize simplicity and deterministic behavior over preserving historical state

---

# Non-Goals

The following systems should **NOT** be implemented:

- Immutable archival/version snapshot systems
- Collaborative editing
- Scenario merge logic
- Cross-campaign shared scenario ownership
- Comments or threaded discussions
- Public API
- Recovery of deleted content
- Anonymous upload support
- Historical redirects for removed scenarios or campaigns