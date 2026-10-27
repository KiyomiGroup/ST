/* Test double for the Supabase UMD global. Scenario comes from window.__SC. */
(function(){
  var listeners=[];
  function sc(){return window.__SC||{};}
  var session = null;
  try { var s=localStorage.getItem('fake_session'); if(s) session=JSON.parse(s); } catch(e){}
  window.__calls=[];
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
        select:function(){return chain;}, eq:function(k,v){q.filters[k]=v;return chain;}, is:function(){return chain;},
        order:function(){return chain;}, in:function(k,v){q.inList=v;return chain;},
        maybeSingle: async function(){ window.__calls.push('from:'+t);
          if(t==='local_tasker_profiles'){
            if(sc().overviewError) return {data:null,error:{message:'rls'}};
            var id=q.filters.tasker_user_id; var mine=(sc().assignments||[]).indexOf(id)>-1; /* simulates RLS */
            var row=(sc().profiles||[]).filter(function(p){return p.tasker_user_id===id;})[0];
            return {data:(mine&&row)?row:null,error:null};
          }
          if(t==='users'){ if(sc().usersError) return {data:null,error:{message:'rls'}}; return {data:(sc().publicName===undefined?{name:'Baba Alabi A.'}:(sc().publicName?{name:sc().publicName}:null)),error:null}; }
          return {data:{display_name:'Chidi Okafor',status:'active'},error:null}; },
        then:function(res,rej){
          window.__calls.push('from:'+t);
          var out;
          if(sc().overviewError) out={data:null,error:{message:'rls'}};
          else if(t==='coordinator_assignments') out={data:(sc().assignments||[]).map(function(id){return {tasker_user_id:id,assigned_at:'2026-10-01'};}),error:null};
          else if(t==='local_tasker_consents'){ out = sc().consentsError ? {data:null,error:{message:'rls'}} : {data:(sc().consents||[]).filter(function(c){return c.tasker_user_id===q.filters.tasker_user_id;}),error:null}; }
          else if(t==='local_tasker_profiles') out={data:(sc().profiles||[]).filter(function(p){return !q.inList||q.inList.indexOf(p.tasker_user_id)>-1;}),error:null};
          else out={data:[],error:null};
          return Promise.resolve(out).then(res,rej);
        }
      };
      return chain;
    }
  };}};
})();
