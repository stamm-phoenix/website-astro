import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    author: z.string().optional(),
  }),
});

const gruppenstunden = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    age: z.string(),
    time: z.string(),
    day: z.string(),
    description: z.string().optional(),
    order: z.number().optional(),
  }),
});

const homepage = defineCollection({
  type: 'data',
  schema: z.object({
    hero: z.object({
      title: z.string(),
      subtitle: z.string(),
      description: z.string(),
      primaryButtonText: z.string(),
      primaryButtonLink: z.string(),
      secondaryButtonText: z.string(),
      secondaryButtonLink: z.string(),
    }),
    quickInfo: z.array(z.object({
      title: z.string(),
      description: z.string(),
      order: z.number(),
    })),
    callToAction: z.object({
      title: z.string(),
      description: z.string(),
      buttonText: z.string(),
      buttonLink: z.string(),
    }),
  }),
});

export const collections = {
  blog,
  gruppenstunden,
  homepage,
};