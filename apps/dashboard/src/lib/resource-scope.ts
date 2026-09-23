export interface ResourceChoice { id: string; name: string; unavailable?: boolean }
export interface ResourceScope { all: boolean; ids: string[] }

export function scopeFromIds(ids: string[]): ResourceScope {
  return { all: ids.length === 0, ids: [...ids] };
}

export function scopeIds(scope: ResourceScope): string[] {
  if (scope.all) return [];
  if (!scope.ids.length) throw new Error("Select at least one item or choose All.");
  if (scope.ids.length > 100) throw new Error("Select up to 100 items.");
  return [...new Set(scope.ids)];
}

// Keep saved references visible even when the resource has since been deleted.
export function scopeChoices(choices: ResourceChoice[], scope: ResourceScope, singular: string): ResourceChoice[] {
  const knownIds = new Set(choices.map((choice) => choice.id));
  return [...choices, ...scope.ids.filter((id) => !knownIds.has(id)).map((id) => ({ id, name: `Unavailable ${singular}`, unavailable: true }))];
}
