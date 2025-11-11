// apps/api/src/merchant-settings/dto/upsert-merchant-settings.dto.ts
export class UpsertMerchantSettingsDto {
    displayName: string;
    logoKey?: string | null;
    defaultCurrency: string;     // e.g. 'AUD'
    functionalCurrency: string;  // e.g. 'AUD'
    updatedByUserId: string;     // Clerk user ID
  }
  