import { NextRequest, NextResponse } from "next/server";
import { getListedTokenIds } from "@/lib/blockchain";

export async function POST(req: NextRequest) {
  try {
    const { tokenIds } = await req.json();
    const allListed = await getListedTokenIds();
    const listed = (tokenIds || []).filter((id: string) => allListed.has(id));
    return NextResponse.json({ listed });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
