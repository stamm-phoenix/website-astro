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

        const blogEntries: BlogEntry[] = items.map((item: unknown): BlogEntry => {
            const listItem = item as {
                id: string;
                eTag: string;
                fields: {
                    Title: string;
                    Inhalt: string;
                    Foto?: string;
                };
                createdBy?: { user?: { displayName?: string } };
                createdDateTime: string;
                lastModifiedBy?: { user?: { displayName?: string } };
                lastModifiedDateTime: string;
            };
            let imageJson: string | undefined = undefined;
            if (listItem.fields.Foto) {
                try {
                    const parsed = JSON.parse(listItem.fields.Foto);
                    imageJson = parsed?.fileName || undefined;
                } catch (e) {
                    imageJson = undefined;
                }
            }
            
            return {
                id: listItem.id,
                eTag: listItem.eTag,
                title: listItem.fields.Title,
                content: listItem.fields.Inhalt,
                imageFileName: imageJson,
                hasImage: imageJson != null,
                createdBy: listItem.createdBy?.user?.displayName ?? "Unbekannt",
                createdAt: listItem.createdDateTime,
                lastModifiedBy: listItem.lastModifiedBy?.user?.displayName ?? "Unbekannt",
                lastModifiedAt: listItem.lastModifiedDateTime
            }
        });

        return blogEntries;
    }, 300);
}