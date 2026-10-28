/* Deterministic, local fixtures. These objects never enter native data stores. */
export const PAGE = "chrome://arc-ui/content/debug.xhtml";
export function ownsPage(url,token) {
  try {const u=new URL(url);return `${u.protocol}//${u.host}${u.pathname}`===PAGE&&u.searchParams.get("debug")===token;}
  catch {return false;}
}
export const PAGES = [
  {title:"Design notes",icon:"spaces.svg",group:"Project",text:"Typography, sidebar spacing, and download states."},
  {title:"Component library",icon:"spaces.svg",group:"Project",text:"Buttons, fields, menus, and keyboard focus states."},
  {title:"Issue tracker",icon:"spaces.svg",group:"Project",text:"Sample issues for checking folder labels and long tab titles."},
  {title:"Reading list",icon:"spaces.svg",group:"Reading",text:"Saved articles and reference material."},
  {title:"A deliberately long title to check truncation in the sidebar",icon:"spaces.svg",group:"Reading",text:"This page checks long labels without loading a website."},
  {title:"Release checklist",icon:"spaces.svg",text:"A sample page for navigation and Split View."},
  {title:"Weekend plans",icon:"spaces.svg",text:"A separate Space with sample personal tabs."},
];
export function createDownloads({directory,image,join=(root,name)=>`${root}/${name}`,now=Date.now(),changed=()=>{},action=()=>{}}) {
  const definitions=[
    ["Sidebar study.png","complete",45,340000,image[0]],
    ["Design notes.pdf","complete",32,820000],
    ["Cancelled transfer.txt","cancelled",18,2400],
    ["Project files.zip","active",9,64000000],
    ["Walkthrough.mp4","paused",6,128000000],
    ["Meeting notes.txt","failed",4,4800],
    ["Interface overview.png","complete",2,420000,image[1]],
  ];
  return definitions.map(([name,state,minutes,size,preview])=>{
    const d={mock:true,source:{url:"https://example.invalid/mock/"+encodeURIComponent(name)},
      target:{path:preview||join(directory,name),size,exists:state==="complete"},
      startTime:new Date(now-minutes*60000),endTime:now-minutes*60000,
      succeeded:state==="complete",stopped:state!=="active",canceled:["paused","cancelled"].includes(state),
      error:state==="failed"?{message:"Mock connection interrupted"}:null,
      hasProgress:["active","paused"].includes(state),hasPartialData:["active","paused"].includes(state),
      currentBytes:Math.floor(size*.38),totalBytes:size,progress:38,speed:1200000,
      launch:async()=>action(`Opened mock file: ${name}`),
      showContainingDirectory:async()=>action(`Mock folder: ${name}`),
      refresh:async()=>{},
      async start(){Object.assign(d,{stopped:false,canceled:false,succeeded:false,error:null,hasProgress:true,hasPartialData:true});changed();},
      async cancel(){Object.assign(d,{stopped:true,canceled:true});changed();},
      async removePartialData(){d.hasPartialData=false;d.hasProgress=false;changed();},
    };
    return d;
  });
}
