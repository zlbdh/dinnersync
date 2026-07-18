export type ResourceId =
  | "cook:1"
  | "oven:1"
  | "burner:1"
  | "burner:2";

export type ResourceRequirement = { resourceId: ResourceId };

export type KitchenResources = {
  cooks: 1;
  ovens: 1;
  burners: 1 | 2;
};

export type TaskMode = "active" | "passive";

const RESOURCE_ORDER: readonly ResourceId[] = [
  "cook:1",
  "oven:1",
  "burner:1",
  "burner:2",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isResourceId(value: unknown): value is ResourceId {
  return typeof value === "string" && RESOURCE_ORDER.some((id) => id === value);
}

export function isTaskMode(value: unknown): value is TaskMode {
  return value === "active" || value === "passive";
}

export function isResourceRequirement(
  value: unknown,
): value is ResourceRequirement {
  return isRecord(value) && isResourceId(value.resourceId);
}

export function isKitchenResources(
  value: unknown,
): value is KitchenResources {
  return isRecord(value) &&
    value.cooks === 1 &&
    value.ovens === 1 &&
    (value.burners === 1 || value.burners === 2);
}

export function effectiveResources(
  mode: TaskMode,
  requirements: readonly ResourceRequirement[],
): ResourceRequirement[] {
  if (!isTaskMode(mode)) {
    throw new TypeError("mode must be active or passive");
  }
  if (!Array.isArray(requirements)) {
    throw new TypeError("requirements must be an array");
  }

  const selected = new Set<ResourceId>();
  for (const requirement of requirements) {
    if (!isResourceRequirement(requirement)) {
      throw new TypeError("requirements contain an unknown resource");
    }
    selected.add(requirement.resourceId);
  }
  if (mode === "active") selected.add("cook:1");

  return RESOURCE_ORDER
    .filter((resourceId) => selected.has(resourceId))
    .map((resourceId) => ({ resourceId }));
}
