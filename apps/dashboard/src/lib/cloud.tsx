import { createContext, useContext } from "react";
export const CloudModelContext = createContext("jev-latest");
export const useCloudModel = () => useContext(CloudModelContext);
export const CloudContext = createContext(false);
export const useCloud = () => useContext(CloudContext);
export interface Organization { id: string; name: string; status: string }
