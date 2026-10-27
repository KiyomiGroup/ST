/* Test double for the Supabase UMD global. Scenario comes from window.__SC. */
(function(){
  var listeners=[];
  function sc(){return window.__SC||{};}
  var session = null;
  try { var s=localStorage.getItem('fake_session'); if(s) session=JSON.parse(s); } catch(e){}
  window.__calls=[];
  function jget(k){ try{ return JSON.parse(sessionStorage.getItem(k)||'[]'); }catch(e){ return []; } }
  function jpush(k,v){ var a=jget(k); a.push(v); try{ sessionStorage.setItem(k,JSON.stringify(a)); }catch(e){} }
  var failCount={};
  function failNow(name,cfg){ if(!cfg||cfg.mode==='ok'||!cfg.mode) return false; if(cfg.times==null) return true; failCount[name]=(failCount[name]||0)+1; return failCount[name]<=cfg.times; }
  function ph(){ if(!window.__PH) window.__PH=JSON.parse(JSON.stringify(sc().photos||[])); return window.__PH; }
  var PX='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  try { window.__rpcCalls=JSON.parse(sessionStorage.getItem('fake_rpc_calls')||'[]'); } catch(e){ window.__rpcCalls=[]; }
  try { window.__fnCalls=JSON.parse(sessionStorage.getItem('fake_fn_calls')||'[]'); } catch(e){ window.__fnCalls=[]; }
  window.supabase = { createClient: function(){ return {
    auth: {
      getSession: async function(){ window.__calls.push('getSession'); if(sc().sessionError) return {data:{session:null},error:{message:'boom'}}; return {data:{session:session},error:null}; },
      signInWithPassword: async function(a){ window.__calls.push('signIn'); 
        if(a.password==='unverified') return {data:null,error:{message:'Email not confirmed'}};
        if(a.password!=='good') return {data:null,error:{message:'Invalid login credentials'}};
        session={user:{id:'u1',email:a.email}}; localStorage.setItem('fake_session',JSON.stringify(session)); return {data:{session:session,user:session.user},error:null}; },
      signOut: async function(){ window.__calls.push('signOut'); session=null; localStorage.removeItem('fake_session'); listeners.forEach(function(f){f('SIGNED_OUT',null)}); return {error:null}; },
      onAuthStateChange: function(f){ listeners.push(f); return {data:{subscription:{unsubscribe:function(){}}}}; },
      resetPasswordForEmail: async function(){ window.__calls.push('reset'); return {error:null}; }
    },
    storage: { from: function(bucket){ return {
      upload: async function(path, blob, opts){
        var u=sc().upl||{mode:'ok'};
        jpush('fake_uploads',{bucket:bucket,path:path,size:blob&&blob.size,type:(opts&&opts.contentType)||(blob&&blob.type),upsert:opts&&opts.upsert});
        if(u.delay) await new Promise(function(r){setTimeout(r,u.delay);});
        if(failNow('upload',u)){
          if(u.mode==='forbidden') return {data:null,error:{message:'new row violates row-level security policy',statusCode:'403'}};
          if(u.mode==='exists') return {data:null,error:{message:'The resource already exists',statusCode:'409'}};
          if(u.mode==='network') return {data:null,error:{message:'TypeError: Failed to fetch'}};
          return {data:null,error:{message:'Internal error',statusCode:'500'}};
        }
        return {data:{path:path},error:null};
      },
      createSignedUrls: async function(paths, secs){
        jpush('fake_signed',{bucket:bucket,paths:paths,secs:secs});
        var g=sc().signed||{mode:'ok'};
        if(g.mode==='error') return {data:null,error:{message:'denied'}};
        return {data:paths.map(function(pp,i){ return (g.mode==='partial'&&i===0)?{path:pp,signedUrl:null,error:'x'}:{path:pp,signedUrl:PX+'#'+encodeURIComponent(pp),error:null}; }),error:null};
      }
    }; } },
    functions: { invoke: async function(name, opts){
      window.__fnCalls.push({name:name, body:opts&&opts.body}); try{ sessionStorage.setItem('fake_fn_calls',JSON.stringify(window.__fnCalls)); }catch(e){}
      var f=sc().fn||{mode:'ok'};
      if(f.delay) await new Promise(function(r){setTimeout(r,f.delay);});
      if(f.mode==='network') return {data:null,error:{name:'FunctionsFetchError',message:'Failed to send a request to the Edge Function'}};
      if(f.mode==='error') return {data:null,error:{name:'FunctionsHttpError',message:'Edge Function returned a non-2xx status code',context:{status:f.status||500,json:async function(){return f.rawBody||{ok:false,error:f.code,message:f.message||'x'};}}}};
      if(f.mode==='badjson') return {data:{unexpected:true},error:null};
      return {data:{ok:true,created:f.created!==false,tasker_user_id:f.id||'44444444-4444-4444-8444-444444444444'},error:null};
    } },
    rpc: async function(n,args){ window.__calls.push('rpc:'+n);
      if(n==='save_local_tasker_service'){
        window.__rpcCalls.push({name:n,args:args}); try{ sessionStorage.setItem('fake_rpc_calls',JSON.stringify(window.__rpcCalls)); }catch(e){}
        var v=sc().svc||{mode:'ok'};
        if(v.delay) await new Promise(function(r){setTimeout(r,v.delay);});
        if(v.mode==='network') return {data:null,error:{message:'TypeError: Failed to fetch'}};
        if(v.mode==='error') return {data:null,error:{code:v.sqlcode||'P0001',hint:v.hint,message:v.message||'x'}};
        if(v.mode==='badjson') return {data:{unexpected:true},error:null};
        return {data:{service_id:v.service_id||'55555555-5555-4555-8555-555555555555',created:v.created!==false&&!args.p_service_id,changed:v.changed||(args.p_service_id?['price']:[])},error:null};
      }
      if(n==='add_local_tasker_photo'||n==='update_local_tasker_photo'||n==='remove_local_tasker_photo'){
        window.__rpcCalls.push({name:n,args:args}); try{ sessionStorage.setItem('fake_rpc_calls',JSON.stringify(window.__rpcCalls)); }catch(e){}
        var cfg=(sc().phrpc||{})[n]||{mode:'ok'};
        if(cfg.delay) await new Promise(function(r){setTimeout(r,cfg.delay);});
        if(failNow(n,cfg)){
          if(cfg.mode==='network') return {data:null,error:{message:'TypeError: Failed to fetch'}};
          if(cfg.mode==='badjson') return {data:{unexpected:true},error:null};
          return {data:null,error:{code:cfg.sqlcode||'P0001',hint:cfg.hint,message:cfg.message||'x'}};
        }
        var L=ph();
        if(n==='add_local_tasker_photo'){
          var dup=L.filter(function(x){return x.storage_path===args.p_path;})[0];
          if(dup) return {data:{photo_id:dup.id,created:false,is_cover:!!dup.is_cover},error:null};
          var cover=L.filter(function(x){return !x.removed_at;}).length===0||!!args.p_make_cover;
          if(cover) L.forEach(function(x){x.is_cover=false;});
          var id='aaaaaaaa-aaaa-4aaa-8aaa-'+('000000000000'+(L.length+1)).slice(-12);
          L.push({id:id,tasker_user_id:args.p_tasker,storage_path:args.p_path,caption:args.p_caption||null,is_cover:cover,created_at:'2026-10-27T10:'+('0'+L.length).slice(-2)+':00Z',removed_at:null});
          if(args.p_consent_method){ (window.__SC.consents=window.__SC.consents||[]).push({tasker_user_id:args.p_tasker,purpose:'photos',method:args.p_consent_method,recorded_at:'2026-10-27T10:00:00Z',revoked_at:null}); }
          return {data:{photo_id:id,created:true,is_cover:cover},error:null};
        }
        var row=L.filter(function(x){return x.id===args.p_photo&&!x.removed_at;})[0];
        if(!row) return {data:null,error:{code:'P0001',hint:'not_found',message:'x'}};
        if(n==='update_local_tasker_photo'){
          var ch=[]; var cap=(args.p_caption||'').trim()||null;
          if((row.caption||null)!==cap){ row.caption=cap; ch.push('caption'); }
          if(args.p_make_cover&&!row.is_cover){ L.forEach(function(x){x.is_cover=false;}); row.is_cover=true; ch.push('cover'); }
          return {data:{photo_id:row.id,changed:ch},error:null};
        }
        row.removed_at='2026-10-27T11:00:00Z'; var wasCover=row.is_cover; row.is_cover=false; var nc=null;
        if(wasCover){ var rest=L.filter(function(x){return !x.removed_at;}); if(rest.length){ rest[0].is_cover=true; nc=rest[0].id; } }
        return {data:{photo_id:row.id,removed:true,new_cover:nc},error:null};
      }
      if(n==='update_local_tasker_profile'){
        window.__rpcCalls.push({name:n,args:args}); try{ sessionStorage.setItem('fake_rpc_calls',JSON.stringify(window.__rpcCalls)); }catch(e){}
        var u=sc().up||{mode:'ok'};
        if(u.delay) await new Promise(function(r){setTimeout(r,u.delay);});
        if(u.mode==='network') return {data:null,error:{message:'TypeError: Failed to fetch'}};
        if(u.mode==='error') return {data:null,error:{code:u.sqlcode||'P0001',hint:u.hint,message:u.message||'x'}};
        if(u.mode==='badjson') return {data:{unexpected:true},error:null};
        return {data:{changed:u.changed||['phone']},error:null};
      }
      if(sc().rpcError) return {data:null,error:{message:'server down'}};
      if(n==='is_active_coordinator') return {data: sc().role==='active', error:null};
      if(n==='is_coordinator') return {data: sc().role==='active'||sc().role==='inactive', error:null};
      return {data:null,error:{message:'unknown'}}; },
    from: function(t){
      var q={t:t,filters:{}};
      var chain={
        select:function(){return chain;}, eq:function(k,v){q.filters[k]=v;return chain;}, is:function(k,v){q.isNull=q.isNull||{};q.isNull[k]=v;return chain;},
        order:function(){return chain;}, in:function(k,v){q.inList=v;return chain;},
        maybeSingle: async function(){ window.__calls.push('from:'+t);
          if(t==='local_tasker_profiles'){
            if(sc().overviewError) return {data:null,error:{message:'rls'}};
            var id=q.filters.tasker_user_id; var mine=(sc().assignments||[]).indexOf(id)>-1; /* simulates RLS */
            var row=(sc().profiles||[]).filter(function(p){return p.tasker_user_id===id;})[0];
            return {data:(mine&&row)?row:null,error:null};
          }
          if(t==='services'){
            if(sc().svcReadError) return {data:null,error:{message:'rls'}};
            var uid=q.filters.user_id, sid=q.filters.id;
            var row=(sc().services||[]).filter(function(x){return x.user_id===uid&&x.id===sid;})[0];
            var mine=(sc().assignments||[]).indexOf(uid)>-1;
            return {data:(mine&&row)?row:null,error:null};
          }
          if(t==='users'){ if(sc().usersError) return {data:null,error:{message:'rls'}}; return {data:(sc().publicName===undefined?{name:'Baba Alabi A.'}:(sc().publicName?{name:sc().publicName}:null)),error:null}; }
          return {data:{display_name:'Chidi Okafor',status:'active'},error:null}; },
        then:function(res,rej){
          window.__calls.push('from:'+t);
          var out;
          if(sc().overviewError) out={data:null,error:{message:'rls'}};
          else if(t==='coordinator_assignments') out={data:(sc().assignments||[]).map(function(id){return {tasker_user_id:id,assigned_at:'2026-10-01'};}),error:null};
          else if(t==='services'){ out = sc().svcReadError ? {data:null,error:{message:'rls'}} : {data:(sc().services||[]).filter(function(x){return x.user_id===q.filters.user_id;}),error:null}; }
          else if(t==='local_tasker_photos'){ out = sc().photosError ? {data:null,error:{message:'rls'}} : {data:ph().filter(function(x){return x.tasker_user_id===q.filters.tasker_user_id&&!x.removed_at;}),error:null}; }
          else if(t==='local_tasker_consents'){ out = sc().consentsError ? {data:null,error:{message:'rls'}} : {data:(sc().consents||[]).filter(function(c){return c.tasker_user_id===q.filters.tasker_user_id&&(!q.filters.purpose||c.purpose===q.filters.purpose)&&(!q.isNull||!('revoked_at' in q.isNull)||(c.revoked_at==null));}),error:null}; }
          else if(t==='local_tasker_profiles') out={data:(sc().profiles||[]).filter(function(p){return !q.inList||q.inList.indexOf(p.tasker_user_id)>-1;}),error:null};
          else out={data:[],error:null};
          return Promise.resolve(out).then(res,rej);
        }
      };
      return chain;
    }
  };}};
})();
