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

export const collections = {
  blog,
  gruppenstunden,
};