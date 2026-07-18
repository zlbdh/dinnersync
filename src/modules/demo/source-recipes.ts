export type DemoSourceRecipe = {
  id: "lemon-herb-chicken" | "roasted-garden-vegetables" | "garlic-butter-rice";
  sourceText: string;
};

export const CHICKEN_SOURCE = [
  "Lemon Herb Chicken",
  "Serves 2.",
  "Ingredients:",
  "- 320 g raw boneless skinless chicken breast",
  "- 13 g olive oil",
  "- 30 g raw lemon juice",
  "- 6 g raw parsley, chopped",
  "- 6 g raw garlic, minced",
  "Steps:",
  "1. Heat the oven to 200 C for 10 minutes.",
  "2. Coat the chicken with half the oil, parsley, and half the garlic; reserve the lemon juice and remaining oil for the pan sauce. Work for 6 minutes.",
  "3. Roast the chicken at 200 C for 22 minutes.",
  "4. Warm the reserved lemon mixture on burner 2 for 4 minutes.",
  "5. Rest, slice, and spoon the warm mixture over the chicken for 3 minutes. This is the final step.",
].join("\n");

export const VEGETABLE_SOURCE = [
  "Roasted Garden Vegetables",
  "Serves 2.",
  "Ingredients:",
  "- 180 g raw broccoli florets",
  "- 160 g raw red bell pepper",
  "- 100 g raw sweet onion",
  "- 13 g olive oil",
  "Steps:",
  "1. Cut and toss the vegetables with the olive oil for 7 minutes.",
  "2. After the oven reaches 200 C, roast the vegetables at 200 C for 20 minutes.",
  "3. Transfer the vegetables to a serving bowl for 2 minutes. This is the final step.",
].join("\n");

export const RICE_SOURCE = [
  "Garlic Butter Rice",
  "Serves 2.",
  "Ingredients:",
  "- 122 g raw long-grain white rice",
  "- 10 g unsalted butter",
  "- 6 g raw garlic, minced",
  "- 320 g water",
  "Steps:",
  "1. Melt the butter with the garlic and stir in the rice on burner 1 for 4 minutes.",
  "2. Add the water, cover, and simmer on burner 1 for 18 minutes.",
  "3. Move the covered pot off the burner and rest for 5 minutes.",
  "4. Fluff the rice for 2 minutes. This is the final step.",
].join("\n");

export const DEMO_SOURCE_RECIPES: readonly DemoSourceRecipe[] = [
  { id: "lemon-herb-chicken", sourceText: CHICKEN_SOURCE },
  { id: "roasted-garden-vegetables", sourceText: VEGETABLE_SOURCE },
  { id: "garlic-butter-rice", sourceText: RICE_SOURCE },
];
