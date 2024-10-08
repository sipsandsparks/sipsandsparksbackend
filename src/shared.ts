export enum Gender {
    MALE = 'Male',
    FEMALE = 'Female'
}

export interface Attendee {
    firstName: string;
    lastName: string;
    email: string;
    gender: Gender;
    id: number;
    inAttendance?: boolean;
    notes?: string;
    cellPhone?: string;
    interests?: number[];
    feedback?: string;
    referralInfo?: string;
    websiteFeedback?: string;
    sendContactToNonMutual?: boolean;
    noShow?: boolean; 
}

export interface QueryError {
    message: string;
}

export interface EventbriteEventsResponse {
    pagination: {
        has_more_items: boolean;
    };
    events: {
        id: string;
        name: {
            text: string;
        };
        start: {
            utc: string;
            local: string;
        };
        end: {
            utc: string;
        }
    }[];
}

export function isQueryError(obj: any): obj is QueryError {
    return obj && typeof obj.message === 'string';
}
