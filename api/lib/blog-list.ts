import {getClient} from "./token";
import {EnvironmentVariable, getEnvironment} from "./environment";
import {cachedFetch} from "./cache";

export interface BlogEntry {
    id: string;
    eTag: string;
    title: string;
    content: string;
    hasImage: boolean;
    imageFileName?: string | undefined;
    createdAt: string;
    createdBy: string;
    lastModifiedAt: string;
    lastModifiedBy: string;
}

export async function getBlogEntries(): Promise<BlogEntry[]> {
    return cachedFetch("blog-list", async () => {
        const client = getClient();

        const SHAREPOINT_HOST_NAME = getEnvironment(
            EnvironmentVariable.SHAREPOINT_HOST_NAME,
        );

        const SHAREPOINT_SITE_ID = getEnvironment(
            EnvironmentVariable.SHAREPOINT_SITE_ID,
        );

        const SHAREPOINT_BLOG_LIST_ID = getEnvironment(
            EnvironmentVariable.SHAREPOINT_BLOG_LIST_ID,
        );

        const response = await client
            .api(
                `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/lists/${SHAREPOINT_BLOG_LIST_ID}/items`,
            )
            .orderby("createdDateTime desc")
            .expand("fields")
            .get();

        const items = Array.isArray(response?.value) ? response.value : [];

        const blogEntries: BlogEntry[] = items.map((item: any): BlogEntry => {
            let imageJson: string | undefined = undefined;
            if (item.fields.Foto) {
                try {
                    const parsed = JSON.parse(item.fields.Foto);
                    imageJson = parsed?.fileName || undefined;
                } catch (e) {
                    imageJson = undefined;
                }
            }
            
            return {
                id: item.id,
                eTag: item.eTag,
                title: item.fields.Title,
                content: item.fields.Inhalt,
                imageFileName: imageJson,
                hasImage: imageJson != null,
                createdBy: item.createdBy?.user?.displayName ?? "Unbekannt",
                createdAt: item.createdDateTime,
                lastModifiedBy: item.lastModifiedBy?.user?.displayName ?? "Unbekannt",
                lastModifiedAt: item.lastModifiedDateTime
            };
        });

        return blogEntries;
    });
}