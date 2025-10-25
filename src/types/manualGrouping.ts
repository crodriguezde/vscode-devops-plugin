export interface ManualGroup {
    id: string;
    name: string;
    prIds: number[];
    createdDate: Date;
    order: number;
}

export interface ManualGroupingState {
    groups: ManualGroup[];
    nextId: number;
}
