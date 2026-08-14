/**
 * The single definition of "this profile carries enough to search on".
 *
 * Discovery builds its Exa query out of the profile (`buildDiscoveryQuery`): with
 * neither a category nor a value proposition there is no phrase to search, so the
 * run is refused up front rather than spent. That rule used to be written twice —
 * once in the add-product wizard, to enable "Create & find competitors", and once in
 * `selfProfileToDiscoveryProfile`, to decide whether a stored self-profile yields a
 * discovery profile at all. Two copies is how a product gets created through the
 * wizard and then answers `missing_profile` on the very next call: the wizard says
 * yes, the API says no, and the user is left on "Couldn't run discovery now" with a
 * product they can't run discovery for.
 */
export interface DiscoveryProfileInputs {
  category?: string | null;
  valueProp?: string | null;
}

export function hasDiscoveryInputs(
  profile: DiscoveryProfileInputs | null | undefined,
): boolean {
  return Boolean(profile?.category?.trim() || profile?.valueProp?.trim());
}
