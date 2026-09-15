import type { RegistrationProduct } from "@/types";

export interface ProductWithAvailability {
  product: RegistrationProduct;
  capacity: number;
  taken: number;
  available: number;
  deadlinePassed: boolean;
}
