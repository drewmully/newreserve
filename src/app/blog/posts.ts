import { createClient } from "@supabase/supabase-js";

export type BlogCategory =
  | "Gear"
  | "Travel"
  | "The Craft"
  | "Inside the Reserve"
  | "Guides"
  | "Partners";

export interface BlogSection {
  heading: string;
  paragraphs: string[];
}

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  category: BlogCategory;
  date: string;
  readTime: string;
  image: string;
  imageAlt: string;
  featured?: boolean;
  intro: string;
  highlights: string[];
  sections: BlogSection[];
  closing: string;
}

export const CATEGORY_COLORS: Record<BlogCategory, string> = {
  Gear: "bg-ember/10 text-ember",
  Travel: "bg-forest/10 text-forest",
  "The Craft": "bg-sage/15 text-sage",
  "Inside the Reserve": "bg-forest/10 text-forest",
  Guides: "bg-ember/10 text-ember",
  Partners: "bg-taupe/20 text-charcoal/65",
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xnfjdbpjuaezxjgargto.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZmpkYnBqdWFlenhqZ2FyZ3RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzMxOTAsImV4cCI6MjA5MDA0OTE5MH0.rY1jpedgZ0qJmIRNJLYJNCuIBwBTljWJGpcZI9-YN_g",
);

function mapRowToPost(row: Record<string, unknown>): BlogPost {
  return {
    slug: row.slug as string,
    title: row.title as string,
    excerpt: row.excerpt as string,
    category: row.category as BlogCategory,
    date: row.date as string,
    readTime: row.read_time as string,
    image: row.image as string,
    imageAlt: row.image_alt as string,
    featured: row.featured as boolean | undefined,
    intro: row.intro as string,
    highlights: row.highlights as string[],
    sections: row.sections as BlogSection[],
    closing: row.closing as string,
  };
}

export async function getAllPublishedPosts(): Promise<BlogPost[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("status", "published")
    .order("publish_date", { ascending: false });
  if (error || !data) return [];
  return data.map(mapRowToPost);
}

export async function getFeaturedPost(): Promise<BlogPost | null> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("status", "published")
    .eq("featured", true)
    .order("publish_date", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return mapRowToPost(data);
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .single();
  if (error || !data) return null;
  return mapRowToPost(data);
}

export async function getRelatedPosts(
  currentSlug: string,
  limit = 3,
): Promise<BlogPost[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("status", "published")
    .neq("slug", currentSlug)
    .order("publish_date", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map(mapRowToPost);
}
