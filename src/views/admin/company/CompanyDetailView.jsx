import React, { useState, useEffect, useContext } from "react";
import { Link, useParams } from "react-router-dom";
import {
  query,
  collection,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Company } from "../../../utils/models/Company";
import { FaStar, FaStarHalfAlt, FaRegStar } from "react-icons/fa";
import { format } from "date-fns/format";
import { Context } from "../../../context/AuthContext";

const functions = getFunctions();

const CompanyDetailView = () => {
  const ADMIN_YELLOW = "#debf44";

  const { user, name } = useContext(Context);
  const { companyId } = useParams();

  const [company, setCompany] = useState({
    id: "",
    companyId: "",
    companyName: "",
    services: [],
    serviceZipCodes: [],
    dateCreated: "",
    description: "",
    duration: "",
  });

  const [notesList, setNotesList] = useState([]);
  const [historyList, setHistoryList] = useState([]);
  const [notes, setNotes] = useState("");
  const [tag, setTag] = useState("");
  const [tagList, setTagList] = useState([]);
  const [needsResolved, setNeedsResolved] = useState(false);

  useEffect(() => {
    const fetchCompany = async () => {
      try {
        const docRef = doc(db, "companies", companyId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          console.log("No such document!");
          return;
        }

        const itemData = Company.fromFirestore(docSnap);
        setCompany(itemData);

        // Admin Notes
        const adminNotesQuery = query(collection(db, "companies", companyId, "adminNotes"));
        const notesQuerySnapshot = await getDocs(adminNotesQuery);

        const nextNotes = [];
        notesQuerySnapshot.forEach((d) => {
          const notesData = d.data();

          const date = notesData?.date?.toDate?.() ? notesData.date.toDate() : new Date();
          const formattedDate = format(date, "MMMM d, yyyy HH:mm:ss");

          const dateResolved = notesData?.dateResolved?.toDate?.()
            ? notesData.dateResolved.toDate()
            : new Date();
          const formattedResolvedDate = format(dateResolved, "MMMM d, yyyy HH:mm:ss");

          nextNotes.push({
            id: notesData.id,
            updaterId: notesData.ownerId,
            updaterName: notesData.updaterName,
            date: notesData.date,
            description: notesData.description,
            tags: notesData.tags,
            needsResolution: notesData.needsResolution,
            resolved: notesData.resolved,
            resoloverId: notesData.resolverId,
            resolverName: notesData.resolverName,
            dateResolved: notesData.dateResolved,
            formattedDate,
            formattedResolvedDate,
          });
        });
        setNotesList(nextNotes);

        // Company History
        const companyHistoryQuery = query(collection(db, "companies", companyId, "companyHistory"));
        const historyQuerySnapshot = await getDocs(companyHistoryQuery);

        const nextHistory = [];
        historyQuerySnapshot.forEach((d) => {
          const historyData = d.data();
          const date = historyData?.date?.toDate?.() ? historyData.date.toDate() : new Date();
          const formattedDate = format(date, "MMMM d, yyyy HH:mm:ss");

          nextHistory.push({
            id: historyData.id,
            updaterId: historyData.ownerId,
            updaterName: historyData.updaterName,
            date: historyData.date,
            description: historyData.description,
            tags: historyData.tags,
            formattedDate,
          });
        });
        setHistoryList(nextHistory);
      } catch (e) {
        console.log("Error on initial Load");
        console.log(e);
      }
    };

    fetchCompany();
  }, [companyId]);

  async function updateNotes(e) {
    e.preventDefault();
    setNotes(e.target.value);
  }

  async function updateTagList(e) {
    e.preventDefault();
    if (!tagList.includes(tag)) {
      if (tag !== "") {
        setTagList((prev) => [...prev, tag]);
        setTag("");
      }
    } else {
      setTag("");
    }
  }

  async function updateResolved(e) {
    e.preventDefault();
    // checkbox: checked means true
    setNeedsResolved(!!e.target.checked);
  }

  async function submitNewNotes(e) {
    e.preventDefault();

    const createCompanyAdminNotes = httpsCallable(functions, "createCompanyAdminNotes");
    const data = {
      updaterId: user.uid,
      updaterName: name,
      companyId: companyId,
      description: notes,
      tags: tagList,
      needsResolution: needsResolved,
      resolved: false,
      resoloverId: "",
      resolverName: "",
      dateResolved: new Date(),
    };

    createCompanyAdminNotes(data)
      .then((result) => result.data)
      .then(async () => {
        const adminNotesQuery = query(collection(db, "companies", companyId, "adminNotes"));
        const notesQuerySnapshot = await getDocs(adminNotesQuery);

        const nextNotes = [];
        notesQuerySnapshot.forEach((d) => {
          const notesData = d.data();

          const date = notesData?.date?.toDate?.() ? notesData.date.toDate() : new Date();
          const formattedDate = format(date, "MMMM d, yyyy HH:mm:ss");

          const dateResolved = notesData?.dateResolved?.toDate?.()
            ? notesData.dateResolved.toDate()
            : new Date();
          const formattedResolvedDate = format(dateResolved, "MMMM d, yyyy HH:mm:ss");

          nextNotes.push({
            id: notesData.id,
            updaterId: notesData.ownerId,
            updaterName: notesData.updaterName,
            date: notesData.date,
            description: notesData.description,
            tags: notesData.tags,
            needsResolution: notesData.needsResolution,
            resolved: notesData.resolved,
            resoloverId: notesData.resolverId,
            resolverName: notesData.resolverName,
            dateResolved: notesData.dateResolved,
            formattedDate,
            formattedResolvedDate,
          });
        });

        setNotesList(nextNotes);
        setNotes("");
        setTag("");
        setTagList([]);
        setNeedsResolved(false);
      })
      .catch((error) => {
        console.error(error);
      });
  }

  // --- Theme helpers ---
  const pageWrap = "px-2 md:px-7 py-5 bg-slate-900 min-h-screen";
  const panel =
    "bg-slate-950 text-slate-100 border border-slate-800/60 rounded-xl shadow-2xl";
  const panelInner = "p-4";
  const title = "font-extrabold text-xl tracking-tight";
  const sectionTitle = "font-bold text-sm uppercase tracking-wider text-slate-400";
  const label = "text-slate-400 font-semibold";
  const text = "text-slate-200";
  const link =
    "underline underline-offset-4 hover:opacity-90";
  const input =
    `w-full px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 placeholder:text-slate-500 ` +
    `focus:outline-none focus:ring-2 focus:ring-[${ADMIN_YELLOW}]/30`;
  const btnPrimary =
    `w-full px-4 py-2 rounded-md font-semibold bg-[${ADMIN_YELLOW}] text-slate-950 hover:bg-[${ADMIN_YELLOW}]/90 transition`;
  const btnAccent =
    `w-full px-4 py-2 rounded-md font-semibold bg-[${ADMIN_YELLOW}]/10 text-[${ADMIN_YELLOW}] ring-1 ring-[${ADMIN_YELLOW}]/30 hover:bg-[${ADMIN_YELLOW}]/15 transition`;

  return (
    <div className={pageWrap}>
      <div className="w-full flex flex-wrap mt-4 gap-4">
        {/* Left Column */}
        <div className="w-full lg:w-1/2 lg:pr-3">
          <div className={`${panel} ${panelInner}`}>
            <h1 className={title} style={{ color: ADMIN_YELLOW }}>
              Company Info
            </h1>

            <div className="mt-3 space-y-2 text-sm">
              <div className={text}>
                <span className={label}>Name:</span> {company.name}
              </div>

              <div className={text}>
                <span className={label}>Verification:</span>{" "}
                {company.needToVerify ? (
                  <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-500/15 text-orange-200 ring-1 ring-orange-400/30">
                    Pending
                  </span>
                ) : company.verified ? (
                  <span
                    className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[${ADMIN_YELLOW}]/15 text-[${ADMIN_YELLOW}] ring-1 ring-[${ADMIN_YELLOW}]/30`}
                  >
                    Verified
                  </span>
                ) : (
                  <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/15 text-red-200 ring-1 ring-red-500/30">
                    Unverified
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className={label}>Rating:</span>
                <FaStar style={{ color: ADMIN_YELLOW }} />
                <FaStar style={{ color: ADMIN_YELLOW }} />
                <FaStar style={{ color: ADMIN_YELLOW }} />
                <FaStarHalfAlt style={{ color: ADMIN_YELLOW }} />
                <FaRegStar className="text-slate-500" />
              </div>

              <div className={text}>
                <span className={label}>Phone:</span> {company.phoneNumber}
              </div>
              <div className={text}>
                <span className={label}>Email:</span> {company.email}
              </div>

              <div className={text}>
                <span className={label}>Website:</span>{" "}
                {company.websiteURL ? (
                  <a
                    href={company.websiteURL}
                    target="_blank"
                    rel="noreferrer"
                    className={link}
                    style={{ color: ADMIN_YELLOW }}
                  >
                    Visit
                  </a>
                ) : (
                  <span className="text-slate-500">None</span>
                )}
              </div>

              <div className={text}>
                <span className={label}>Yelp:</span>{" "}
                {company.yelpURL ? (
                  <a
                    href={company.yelpURL}
                    target="_blank"
                    rel="noreferrer"
                    className={link}
                    style={{ color: ADMIN_YELLOW }}
                  >
                    View
                  </a>
                ) : (
                  <span className="text-slate-500">None</span>
                )}
              </div>
            </div>
          </div>

          <div className={`${panel} ${panelInner} mt-4`}>
            <div className={sectionTitle}>Owner Information</div>
            <div className="mt-2 text-sm text-slate-200">
              <span className={label}>Owner Name:</span> {company.ownerName}
            </div>
          </div>

          <div className={`${panel} ${panelInner} mt-4`}>
            <div className={sectionTitle}>Services</div>

            <div className="mt-3">
              <div className={label}>Service Zip Codes:</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(company.serviceZipCodes || []).map((item) => (
                  <span
                    key={item}
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold
                      bg-[${ADMIN_YELLOW}]/10 text-[${ADMIN_YELLOW}] ring-1 ring-[${ADMIN_YELLOW}]/25`}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <div className={label}>Services:</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(company.services || []).map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold
                      bg-slate-900/70 text-slate-200 ring-1 ring-slate-800/60"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className={`${panel} ${panelInner} mt-4`}>
            <h1 className="font-bold" style={{ color: ADMIN_YELLOW }}>
              Reviews
            </h1>
            <div className="text-sm text-slate-400 mt-2">Coming soon…</div>
          </div>

          <div className={`${panel} ${panelInner} mt-4`}>
            <h1 className="font-bold" style={{ color: ADMIN_YELLOW }}>
              File Complaint
            </h1>
            <div className="text-sm text-slate-400 mt-2">Coming soon…</div>
          </div>
        </div>

        {/* Middle Column: Admin Notes */}
        <div className="w-full lg:w-1/4 lg:pr-3">
          <div className={`${panel} ${panelInner}`}>
            <h1 className={title} style={{ color: ADMIN_YELLOW }}>
              Admin Notes
            </h1>

            <div className="mt-4 rounded-lg border border-slate-800/60 overflow-hidden">
              <div className="p-3 bg-slate-900/40">
                <textarea
                  className={`block w-full text-sm rounded-md ${input} min-h-[120px]`}
                  placeholder="Notes..."
                  onChange={(e) => updateNotes(e)}
                  value={notes}
                />

                <div className="mt-3">
                  <input
                    value={tag}
                    className={input}
                    onChange={(e) => setTag(e.target.value)}
                    type="text"
                    name="Tag"
                    placeholder="Tag"
                  />
                </div>

                <button onClick={(e) => updateTagList(e)} className={`${btnAccent} mt-3`}>
                  Add Tag
                </button>

                <div className="flex justify-between items-center mt-3 text-sm text-slate-200">
                  <span className={label}>Needs Resolution</span>
                  <input
                    type="checkbox"
                    checked={needsResolved}
                    onChange={(e) => updateResolved(e)}
                    className={`h-4 w-4 rounded border-slate-700 bg-slate-900 text-[${ADMIN_YELLOW}] focus:ring-[${ADMIN_YELLOW}]/30`}
                  />
                </div>

                {tagList.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {tagList.map((item, index) => (
                      <li
                        key={index}
                        className={`text-xs font-semibold px-2.5 py-0.5 rounded-full
                          bg-[${ADMIN_YELLOW}]/10 text-[${ADMIN_YELLOW}] ring-1 ring-[${ADMIN_YELLOW}]/25`}
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                )}

                <button onClick={(e) => submitNewNotes(e)} className="font-bold" style={{ color: ADMIN_YELLOW }}>
                  Submit Notes
                </button>
              </div>
            </div>

            <div className="mt-4 text-sm text-slate-500">
              <div>Sort by Date</div>
              <div>Filter by Tags</div>
            </div>

            <ul className="mt-4 space-y-3">
              {notesList.map((item, index) => (
                <li key={index} className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-3">
                  <div className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">{item.updaterName}</span>{" "}
                    • {item.formattedDate}
                  </div>

                  {item.needsResolution && (
                    <div className="mt-2 text-xs">
                      {item.resolved ? (
                        <span className={`text-[${ADMIN_YELLOW}]`}>
                          Resolved by {item.resolverName} on {item.formattedResolvedDate}
                        </span>
                      ) : (
                        <span className="text-orange-200">Not Resolved Yet</span>
                      )}
                    </div>
                  )}

                  <div className="mt-2 text-sm text-slate-200">{item.description}</div>

                  {Array.isArray(item.tags) && item.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.tags.map((t, i) => (
                        <span
                          key={`${t}-${i}`}
                          className={`text-xs font-semibold px-2.5 py-0.5 rounded-full
                            bg-[${ADMIN_YELLOW}]/10 text-[${ADMIN_YELLOW}] ring-1 ring-[${ADMIN_YELLOW}]/25`}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right Column: Company History */}
        <div className="w-full lg:w-1/4 lg:pr-3">
          <div className={`${panel} ${panelInner}`}>
            <h1 className={title} style={{ color: ADMIN_YELLOW }}>
              Company History
            </h1>

            <div className="mt-4 text-sm text-slate-500">
              <div>Sort by Date</div>
              <div>Filter by Tags</div>
            </div>

            <ul className="mt-4 space-y-3">
              {historyList.map((item, index) => (
                <li key={index} className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-3">
                  <div className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">{item.updaterName}</span>{" "}
                    • {item.formattedDate}
                  </div>
                  <div className="mt-2 text-sm text-slate-200">{item.description}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyDetailView;
