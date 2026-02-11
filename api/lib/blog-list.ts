import {cachedFetch} from "./cache";
import {getSharePointListItems} from "./sharepoint-data-access";
import {EnvironmentVariable, getEnvironment} from "./environment";

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
        const SHAREPOINT_BLOG_LIST_ID = getEnvironment(
            EnvironmentVariable.SHAREPOINT_BLOG_LIST_ID,
        );

        const items = await getSharePointListItems(SHAREPOINT_BLOG_LIST_ID, {
            orderby: "createdDateTime desc",
            expand: "fields"
        });

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
    }, 300);
}